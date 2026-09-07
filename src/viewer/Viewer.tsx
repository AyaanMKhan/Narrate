/**
 * Narrate's own PDF reader.
 *
 * Chrome's built-in viewer paints PDFs with PDFium inside an <embed>, whose
 * text a content script can never reach. So we render the document ourselves:
 * a canvas per page with PDF.js's real-DOM text layer on top, which means the
 * existing selection + highlighting machinery works unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { BRAND } from '@/shared/constants';
import { chunkText } from '@/shared/chunk';
import { api } from '@/shared/messaging';
import type { Chunk } from '@/shared/types';
import * as highlighter from '@/content/highlighter';
import { useNarrateState } from '@/content/useNarrateState';
import SpeedPicker from '@/popup/components/SpeedPicker';
import {
  cancelPage,
  extractPageText,
  getPageSize,
  loadDocument,
  releasePage,
  renderPage,
  type PageSize,
  type PDFDocumentProxy,
  type RenderedPage,
} from './pdf';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const DEFAULT_ZOOM = 1.25;
/** Keep the spoken line clear of the sticky toolbar when auto-scrolling. */
const TOOLBAR_CLEARANCE = 96;
/** Beyond this many pages, extraction is slow enough to deserve a progress bar. */
const PROGRESS_AFTER_PAGES = 20;
const MIN_SELECTION_CHARS = 2;
const FALLBACK_SIZE: PageSize = { width: 612, height: 792 };

type Phase = 'empty' | 'loading' | 'ready' | 'error';

interface LoadError {
  message: string;
  /** file:// needs an explicit opt-in that only the user can grant. */
  needsFileAccess: boolean;
}

/**
 * What we handed to the engine, and how its chunk offsets map back onto the
 * document. `offsets` / `lengths` are indexed by page number - 1; pages before
 * the starting page have length 0.
 */
type Narration =
  | { kind: 'selection'; chunks: Chunk[] }
  | { kind: 'pages'; chunks: Chunk[]; offsets: number[]; lengths: number[] };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Something went wrong';
}

function fileNameFrom(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').pop() ?? '');
    return last || 'Document.pdf';
  } catch {
    return 'Document.pdf';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Which page holds this offset into the narrated text. */
function pageOfOffset(narration: Narration, offset: number): number | null {
  if (narration.kind !== 'pages') return null;
  for (let index = narration.offsets.length - 1; index >= 0; index--) {
    if (narration.lengths[index] > 0 && offset >= narration.offsets[index]) return index + 1;
  }
  return null;
}

/**
 * The span holding the Nth character of a text layer's collapsed text. Counts
 * exactly the way highlighter.capture() does, so the two always agree.
 */
function spanAt(layer: HTMLElement, index: number): HTMLElement | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let count = 0;
  let pendingSpace = false;
  let node = walker.nextNode() as Text | null;

  while (node) {
    for (let i = 0; i < node.data.length; i++) {
      if (/\s/.test(node.data[i])) {
        if (count) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        if (count === index) return node.parentElement;
        count++;
        pendingSpace = false;
      }
      if (count === index) return node.parentElement;
      count++;
    }
    node = walker.nextNode() as Text | null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function Mark({ className = 'n-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <path d="M3 8.6v2.8" />
        <path d="M6.7 5.8v8.4" />
        <path d="M10.4 3.4v13.2" />
        <path d="M14.1 6.6v6.8" />
        <path d="M17.6 9v2" />
      </g>
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5 3.2a.7.7 0 0 1 1.07-.6l6.1 4.8a.7.7 0 0 1 0 1.2l-6.1 4.8A.7.7 0 0 1 5 12.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.2" y="3" width="2.9" height="10" rx="1.2" fill="currentColor" />
      <rect x="8.9" y="3" width="2.9" height="10" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function IconSkip({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={back ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path
        d="M4 4.1a.6.6 0 0 1 .93-.5l5.3 3.4a.6.6 0 0 1 0 1l-5.3 3.4a.6.6 0 0 1-.93-.5z"
        fill="currentColor"
      />
      <rect x="11" y="3.4" width="1.7" height="9.2" rx=".85" fill="currentColor" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.8" fill="currentColor" />
    </svg>
  );
}

function IconChevron({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={up ? { transform: 'scaleY(-1)' } : undefined}>
      <path
        d="M4.4 6.2 8 9.8l3.6-3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconZoom({ out = false }: { out?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.4 8h9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {out ? null : (
        <path d="M8 3.4v9.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* One page                                                            */
/* ------------------------------------------------------------------ */

interface PdfPageViewProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  /** Unscaled page size, used for the placeholder box. */
  size: PageSize;
  /** False once the page is far enough away to give its canvas back. */
  render: boolean;
  onRendered: (pageNumber: number, page: RenderedPage) => void;
  onReleased: (pageNumber: number) => void;
  onSlot: (pageNumber: number, element: HTMLDivElement | null) => void;
}

function PdfPageView({
  doc,
  pageNumber,
  scale,
  size,
  render,
  onRendered,
  onReleased,
  onSlot,
}: PdfPageViewProps) {
  const layersRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = layersRef.current;
    if (!host) return undefined;

    if (!render) {
      releasePage(doc, pageNumber, host);
      setReady(false);
      onReleased(pageNumber);
      return undefined;
    }

    let alive = true;
    void renderPage(doc, pageNumber, host, scale)
      .then((rendered) => {
        if (!alive || !rendered) return;
        setReady(true);
        onRendered(pageNumber, rendered);
      })
      .catch(() => {
        /* a single unreadable page must not take the document down */
      });

    return () => {
      alive = false;
      cancelPage(pageNumber);
    };
  }, [doc, pageNumber, scale, render, onRendered, onReleased]);

  const style: CSSProperties = {
    width: `${Math.round(size.width * scale)}px`,
    height: `${Math.round(size.height * scale)}px`,
  };

  return (
    <div
      className="n-page"
      data-page={pageNumber}
      style={style}
      ref={(element) => onSlot(pageNumber, element)}
    >
      {/* PDF.js owns this node's children; React never renders into it. */}
      <div className="n-page__layers" ref={layersRef} />
      {ready ? null : <div className="n-page__pending">{pageNumber}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

export default function Viewer() {
  const { state, settings } = useNarrateState();

  const [phase, setPhase] = useState<Phase>('empty');
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [fileName, setFileName] = useState('');
  const [sizes, setSizes] = useState<Record<number, PageSize>>({});
  const [firstSize, setFirstSize] = useState<PageSize>(FALLBACK_SIZE);
  const [scale, setScale] = useState(DEFAULT_ZOOM);
  const [currentPage, setCurrentPage] = useState(1);
  const [nearPages, setNearPages] = useState<Set<number>>(() => new Set([1]));
  const [spokenPage, setSpokenPage] = useState<number | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);
  const [extracting, setExtracting] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [rateOverride, setRateOverride] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const slotsRef = useRef(new Map<number, HTMLDivElement>());
  const layersRef = useRef(new Map<number, HTMLElement>());
  const centeredRef = useRef(new Set<number>());
  const pageTextsRef = useRef<string[]>([]);
  const extractingRef = useRef<Promise<string[]> | null>(null);
  const narrationRef = useRef<Narration | null>(null);
  const capturedRef = useRef<number | null>(null);

  const active =
    state.status === 'loading' || state.status === 'playing' || state.status === 'paused';
  const baseRate = state.status === 'idle' ? settings.rate : state.rate;
  const rate = rateOverride ?? baseRate;

  useEffect(() => {
    if (rateOverride !== null && Math.abs(baseRate - rateOverride) < 0.001) setRateOverride(null);
  }, [baseRate, rateOverride]);

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  const openSource = useCallback(async (source: ArrayBuffer | string, name: string) => {
    setPhase('loading');
    setLoadError(null);
    setNotice(null);
    try {
      const next = await loadDocument(source);
      const size = await getPageSize(next, 1);

      highlighter.reset();
      narrationRef.current = null;
      capturedRef.current = null;
      pageTextsRef.current = [];
      extractingRef.current = null;
      slotsRef.current.clear();
      layersRef.current.clear();
      centeredRef.current.clear();

      setDoc(next);
      setPageCount(next.numPages);
      setFileName(name);
      setFirstSize(size);
      setSizes({});
      setCurrentPage(1);
      setSpokenPage(null);
      setNearPages(new Set([1]));
      setExtracting(null);
      setPhase('ready');
    } catch (error: unknown) {
      setPhase('error');
      setLoadError({ message: describe(error), needsFileAccess: false });
    }
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        setPhase('error');
        setLoadError({ message: `“${file.name}” isn’t a PDF.`, needsFileAccess: false });
        return;
      }
      setPhase('loading');
      await openSource(await file.arrayBuffer(), file.name);
    },
    [openSource],
  );

  const openUrl = useCallback(
    async (url: string) => {
      setPhase('loading');
      setLoadError(null);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
        await openSource(await response.arrayBuffer(), fileNameFrom(url));
      } catch (error: unknown) {
        setPhase('error');
        setLoadError(
          url.startsWith('file:')
            ? {
                message: 'Narrate can’t read files on your disk yet.',
                needsFileAccess: true,
              }
            : { message: `Couldn’t open this PDF — ${describe(error)}`, needsFileAccess: false },
        );
      }
    },
    [openSource],
  );

  /* The background redirects PDFs here as ?file=<encoded url>, or as
     ?drive=<handoff id> when a Drive preview page fetched the bytes itself
     (see DrivePdfButton) and is waiting for us to collect them. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const driveId = params.get('drive');
    if (driveId) {
      setPhase('loading');
      void api.getDrivePdf(driveId).then((entry) => {
        if (entry) void openSource(entry.buffer, entry.name);
        else {
          setPhase('error');
          setLoadError({
            message: 'This Drive handoff expired — open the file in Drive again and retry.',
            needsFileAccess: false,
          });
        }
      });
      return;
    }
    const target = params.get('file');
    if (target) void openUrl(target);
  }, [openUrl, openSource]);

  useEffect(() => {
    document.title = fileName ? `${fileName} — ${BRAND.name}` : `${BRAND.name} — PDF Reader`;
  }, [fileName]);

  /* Drag and drop anywhere in the window. */
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

  /* ---------------------------------------------------------------- */
  /* Virtualization                                                    */
  /* ---------------------------------------------------------------- */

  const onSlot = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) slotsRef.current.set(pageNumber, element);
    else slotsRef.current.delete(pageNumber);
  }, []);

  const onRendered = useCallback((pageNumber: number, page: RenderedPage) => {
    layersRef.current.set(pageNumber, page.textLayer);
    setSizes((prev) => {
      const known = prev[pageNumber];
      const next = { width: page.size.width, height: page.size.height };
      if (known && Math.abs(known.width - next.width) < 0.5) return prev;
      return { ...prev, [pageNumber]: next };
    });
    setRenderNonce((value) => value + 1);
  }, []);

  const onReleased = useCallback((pageNumber: number) => {
    if (!layersRef.current.delete(pageNumber)) return;
    // The captured anchors pointed into DOM we just threw away.
    if (capturedRef.current === pageNumber) capturedRef.current = null;
    setRenderNonce((value) => value + 1);
  }, []);

  /* Render only what is near the viewport; ~one screen of slack each way. */
  useEffect(() => {
    if (!doc || !pageCount) return undefined;

    const near = new IntersectionObserver(
      (entries) => {
        setNearPages((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (!page) continue;
            if (entry.isIntersecting) {
              if (!next.has(page)) {
                next.add(page);
                changed = true;
              }
            } else if (next.delete(page)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { rootMargin: '100% 0px' },
    );

    const centered = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!page) continue;
          if (entry.isIntersecting) centeredRef.current.add(page);
          else centeredRef.current.delete(page);
        }
        const pages = Array.from(centeredRef.current);
        if (pages.length) setCurrentPage(Math.min(...pages));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );

    for (const element of slotsRef.current.values()) {
      near.observe(element);
      centered.observe(element);
    }
    return () => {
      near.disconnect();
      centered.disconnect();
    };
  }, [doc, pageCount]);

  const renderSet = useMemo(() => {
    const next = new Set(nearPages);
    if (spokenPage) next.add(spokenPage);
    next.add(currentPage);
    return next;
  }, [nearPages, spokenPage, currentPage]);

  const goToPage = useCallback(
    (pageNumber: number) => {
      const target = clamp(pageNumber, 1, Math.max(1, pageCount));
      setCurrentPage(target);
      slotsRef.current.get(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    [pageCount],
  );

  const zoomBy = useCallback((direction: number) => {
    setScale((prev) => {
      const index = ZOOMS.findIndex((zoom) => Math.abs(zoom - prev) < 0.001);
      const from = index === -1 ? ZOOMS.findIndex((zoom) => zoom >= prev) : index;
      return ZOOMS[clamp((from === -1 ? ZOOMS.length - 1 : from) + direction, 0, ZOOMS.length - 1)];
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Text + narration                                                  */
  /* ---------------------------------------------------------------- */

  const ensureText = useCallback(async (): Promise<string[]> => {
    if (!doc) return [];
    if (pageTextsRef.current.length === doc.numPages) return pageTextsRef.current;
    if (extractingRef.current) return extractingRef.current;

    const total = doc.numPages;
    const run = (async () => {
      const texts: string[] = [];
      const showProgress = total > PROGRESS_AFTER_PAGES;
      if (showProgress) setExtracting({ done: 0, total });
      for (let page = 1; page <= total; page++) {
        texts.push(await extractPageText(doc, page).catch(() => ''));
        if (showProgress) setExtracting({ done: page, total });
      }
      pageTextsRef.current = texts;
      setExtracting(null);
      return texts;
    })();

    extractingRef.current = run;
    try {
      return await run;
    } finally {
      extractingRef.current = null;
    }
  }, [doc]);

  const readFromPage = useCallback(
    async (from: number) => {
      if (!doc) return;
      const texts = await ensureText();

      // Page texts are already collapsed, so joining with single spaces keeps
      // chunkText()'s offsets addressing the very characters we can highlight.
      const offsets: number[] = [];
      const lengths: number[] = [];
      let text = '';
      for (let page = 1; page <= texts.length; page++) {
        const pageText = page >= from ? texts[page - 1] : '';
        if (!pageText) {
          offsets[page - 1] = text.length;
          lengths[page - 1] = 0;
          continue;
        }
        if (text) text += ' ';
        offsets[page - 1] = text.length;
        lengths[page - 1] = pageText.length;
        text += pageText;
      }

      if (!text) {
        setNotice('No selectable text from here on — this part of the PDF may be scanned images.');
        return;
      }

      highlighter.reset();
      capturedRef.current = null;
      narrationRef.current = { kind: 'pages', chunks: chunkText(text), offsets, lengths };
      setNotice(null);
      setSpokenPage(from);
      void api.speak(text, fileName);
    },
    [doc, ensureText, fileName],
  );

  const narrateSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (text.length < MIN_SELECTION_CHARS) return;

    const range = selection.getRangeAt(0).cloneRange();
    highlighter.reset();
    narrationRef.current = { kind: 'selection', chunks: chunkText(text) };
    highlighter.capture(range);
    capturedRef.current = null;
    setNotice(null);
    setSpokenPage(null);
    void api.speak(text, fileName);
  }, [fileName]);

  /* Track the selection ourselves — content scripts don't run on our pages. */
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selection = document.getSelection();
        const text = selection && !selection.isCollapsed ? selection.toString().trim() : '';
        setSelectionCount(text.length);
      }, 120);
    };
    document.addEventListener('selectionchange', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Highlighting                                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const narration = narrationRef.current;
    if (!narration || !settings.highlightSpoken || !active) {
      highlighter.clear();
      return;
    }
    const chunk = narration.chunks[state.chunkIndex];
    if (!chunk) return;

    if (narration.kind === 'selection') {
      highlighter.paint(chunk.start, chunk.end);
      return;
    }

    const page = pageOfOffset(narration, chunk.start);
    if (!page) return;
    setSpokenPage(page);

    const layer = layersRef.current.get(page);
    // Page is virtualized away: this effect re-runs once it has rendered.
    if (!layer) return;

    if (capturedRef.current !== page) {
      const range = document.createRange();
      range.selectNodeContents(layer);
      highlighter.capture(range);
      capturedRef.current = page;
    }

    const offset = narration.offsets[page - 1];
    const start = chunk.start - offset;
    highlighter.paint(start, chunk.end - offset);

    const span = spanAt(layer, start);
    if (!span) return;
    const rect = span.getBoundingClientRect();
    if (rect.top < TOOLBAR_CLEARANCE || rect.bottom > window.innerHeight) {
      span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [state.chunkIndex, state.status, settings.highlightSpoken, active, renderNonce]);

  useEffect(() => {
    if (state.status !== 'idle') return;
    highlighter.reset();
    narrationRef.current = null;
    capturedRef.current = null;
    setSpokenPage(null);
  }, [state.status]);

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                          */
  /* ---------------------------------------------------------------- */

  const togglePlayback = useCallback(() => {
    if (state.status === 'playing') void api.pause();
    else if (state.status === 'paused') void api.resume();
    else if (phase === 'ready') void readFromPage(currentPage);
  }, [state.status, phase, readFromPage, currentPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPage(currentPage - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPage(currentPage + 1);
      } else if (event.key === 'Escape') {
        void api.stop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlayback, goToPage, currentPage]);

  const handleRate = useCallback((next: number) => {
    setRateOverride(next);
    void api.setRate(next);
  }, []);

  const copyExtensionsLink = useCallback(() => {
    const url = `chrome://extensions/?id=${chrome.runtime.id}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  const chunkLabel = state.chunkCount
    ? `${Math.min(state.chunkIndex + 1, state.chunkCount)} / ${state.chunkCount}`
    : null;

  const picker = (
    <input
      ref={fileInputRef}
      className="n-file-input"
      type="file"
      accept="application/pdf"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void openFile(file);
      }}
    />
  );

  if (phase !== 'ready') {
    return (
      <div className={`n-viewer n-viewer--intro${dragging ? ' is-dragging' : ''}`}>
        {picker}
        <div className="n-intro">
          <div className="n-intro__brand">
            <Mark className="n-intro__mark" />
            <span className="n-intro__name">{BRAND.name}</span>
          </div>

          {phase === 'loading' ? (
            <div className="n-drop is-busy">
              <div className="n-spinner" aria-hidden="true" />
              <h1 className="n-drop__title">Opening your PDF…</h1>
            </div>
          ) : phase === 'error' && loadError ? (
            <div className="n-drop is-error" role="alert">
              <h1 className="n-drop__title">Couldn’t open that document</h1>
              <p className="n-drop__hint">{loadError.message}</p>
              {loadError.needsFileAccess ? (
                <>
                  <p className="n-drop__hint">
                    Open Narrate’s entry on the extensions page and turn on{' '}
                    <strong>Allow access to file URLs</strong>, then reload this tab. Chrome doesn’t
                    let a page link to <code>chrome://</code>, so copy the address instead.
                  </p>
                  <div className="n-drop__actions">
                    <button type="button" className="n-btn" onClick={copyExtensionsLink}>
                      {copied ? 'Copied — paste it in a new tab' : 'Copy extensions link'}
                    </button>
                    <button
                      type="button"
                      className="n-btn n-btn--primary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose a file…
                    </button>
                  </div>
                </>
              ) : (
                <div className="n-drop__actions">
                  <button
                    type="button"
                    className="n-btn n-btn--primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose a file…
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="n-drop">
              <Mark className="n-drop__mark" />
              <h1 className="n-drop__title">Drop a PDF here</h1>
              <p className="n-drop__hint">
                Then hit play and Narrate reads it aloud, highlighting each sentence as it goes.
              </p>
              <div className="n-drop__actions">
                <button
                  type="button"
                  className="n-btn n-btn--primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose a file…
                </button>
              </div>
              <p className="n-drop__note">
                Your file is opened entirely on your device. Nothing is uploaded anywhere.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`n-viewer${dragging ? ' is-dragging' : ''}`}>
      {picker}

      <header className="n-toolbar">
        <div className="n-toolbar__row">
          <div className="n-doc" title={fileName}>
            <Mark className="n-doc__mark" />
            <span className="n-doc__name">{fileName}</span>
          </div>

          <div className="n-group" role="group" aria-label="Pages">
            <button
              type="button"
              className="n-icon-btn n-icon-btn--sm"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
            >
              <IconChevron up />
            </button>
            <span className="n-counter" aria-live="polite">
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              className="n-icon-btn n-icon-btn--sm"
              aria-label="Next page"
              disabled={currentPage >= pageCount}
              onClick={() => goToPage(currentPage + 1)}
            >
              <IconChevron />
            </button>
          </div>

          <div className="n-group" role="group" aria-label="Zoom">
            <button
              type="button"
              className="n-icon-btn n-icon-btn--sm"
              aria-label="Zoom out"
              disabled={scale <= ZOOMS[0]}
              onClick={() => zoomBy(-1)}
            >
              <IconZoom out />
            </button>
            <span className="n-counter">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              className="n-icon-btn n-icon-btn--sm"
              aria-label="Zoom in"
              disabled={scale >= ZOOMS[ZOOMS.length - 1]}
              onClick={() => zoomBy(1)}
            >
              <IconZoom />
            </button>
          </div>

          <div className="n-toolbar__spacer" />

          {active ? (
            <div className="n-transport" role="group" aria-label="Narration">
              <button
                type="button"
                className="n-icon-btn"
                aria-label="Previous sentence"
                disabled={!state.chunkCount}
                onClick={() => void api.skip(-1)}
              >
                <IconSkip back />
              </button>
              <button
                type="button"
                className="n-icon-btn n-icon-btn--primary"
                aria-label={state.status === 'playing' ? 'Pause' : 'Play'}
                disabled={state.status === 'loading'}
                onClick={togglePlayback}
              >
                {state.status === 'playing' ? <IconPause /> : <IconPlay />}
              </button>
              <button
                type="button"
                className="n-icon-btn"
                aria-label="Next sentence"
                disabled={!state.chunkCount}
                onClick={() => void api.skip(1)}
              >
                <IconSkip />
              </button>
              <button
                type="button"
                className="n-icon-btn"
                aria-label="Stop narration"
                onClick={() => void api.stop()}
              >
                <IconStop />
              </button>
              {chunkLabel ? <span className="n-counter">{chunkLabel}</span> : null}
            </div>
          ) : (
            <button
              type="button"
              className="n-btn n-btn--primary"
              disabled={!!extracting}
              onClick={() => void readFromPage(currentPage)}
            >
              {extracting ? 'Reading the document…' : 'Read from this page'}
            </button>
          )}

          <div className="n-toolbar__speed">
            <SpeedPicker value={rate} onChange={handleRate} />
          </div>
        </div>

        {extracting ? (
          <div className="n-toolbar__progress">
            <div className="n-progress">
              <div
                className="n-progress__fill"
                style={{ width: `${Math.round((extracting.done / extracting.total) * 100)}%` }}
              />
            </div>
            <span className="n-counter">
              Preparing text — page {extracting.done} of {extracting.total}
            </span>
          </div>
        ) : null}

        {state.status === 'error' && state.error ? (
          <p className="n-toolbar__error" role="alert">
            {state.error}
          </p>
        ) : notice ? (
          <p className="n-toolbar__notice">{notice}</p>
        ) : null}
      </header>

      <main className="n-pages">
        {doc
          ? pages.map((pageNumber) => (
              <PdfPageView
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                scale={scale}
                size={sizes[pageNumber] ?? firstSize}
                render={renderSet.has(pageNumber)}
                onRendered={onRendered}
                onReleased={onReleased}
                onSlot={onSlot}
              />
            ))
          : null}
      </main>

      {selectionCount >= MIN_SELECTION_CHARS ? (
        <button type="button" className="n-selection-btn" onClick={narrateSelection}>
          <IconPlay />
          Narrate selection
        </button>
      ) : null}
    </div>
  );
}
