import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import tokens from '@/ui/tokens.css?inline';
import styles from './content.css?inline';
import { api } from '@/shared/messaging';
import { SelectionBubble, type AnchorRect } from './SelectionBubble';
import { MiniPlayer } from './MiniPlayer';
import { DrivePdfButton } from './DrivePdfButton';
import { useNarrateState } from './useNarrateState';
import * as highlighter from './highlighter';
import { chunkText } from '@/shared/chunk';
import type { Chunk } from '@/shared/types';

const HOST_ID = 'narrate-root-9f2c';
const DEBOUNCE_MS = 150;
const MIN_SELECTION_CHARS = 2;

interface SelectionInfo {
  text: string;
  rect: AnchorRect;
}

/* ------------------------------------------------------------------ */
/* Selection plumbing                                                  */
/* ------------------------------------------------------------------ */

function toElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** True when the caret lives in a field the user is actively editing. */
function isEditableContext(node: Node | null): boolean {
  const el = toElement(node);
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  const owner = el.closest('input, textarea, select, [contenteditable]');
  if (!owner) return false;
  if (owner instanceof HTMLElement && owner.isContentEditable) return true;
  return (
    owner instanceof HTMLInputElement ||
    owner instanceof HTMLTextAreaElement ||
    owner instanceof HTMLSelectElement
  );
}

function rectOf(range: Range): AnchorRect | null {
  const r = range.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}

function isOnScreen(rect: AnchorRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/** Current page selection, or null when it is unusable / not ours to touch. */
function readSelection(host: Element): { info: SelectionInfo; range: Range } | null {
  let selection: Selection | null = null;
  try {
    selection = document.getSelection();
  } catch {
    return null;
  }
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (text.length < MIN_SELECTION_CHARS) return null;

  const range = selection.getRangeAt(0);
  if (host.contains(range.commonAncestorContainer)) return null;
  if (isEditableContext(selection.anchorNode)) return null;

  const rect = rectOf(range);
  if (!rect || !isOnScreen(rect)) return null;

  return { info: { text, rect }, range: range.cloneRange() };
}

export function currentSelectionText(): string {
  try {
    return document.getSelection()?.toString().trim() ?? '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

interface ContentAppProps {
  host: HTMLElement;
}

function ContentApp({ host }: ContentAppProps) {
  const { state, settings } = useNarrateState();
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [forced, setForced] = useState(false);
  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const rangeRef = useRef<Range | null>(null);
  const chunksRef = useRef<Chunk[]>([]);

  const active =
    state.status === 'loading' || state.status === 'playing' || state.status === 'paused';
  const showPlayer = active || state.status === 'error';

  const baseRate = state.status === 'idle' ? settings.rate : state.rate;
  const rate = rateOverride ?? baseRate;
  useEffect(() => {
    if (rateOverride !== null && Math.abs(baseRate - rateOverride) < 0.001) setRateOverride(null);
  }, [baseRate, rateOverride]);

  const clear = useCallback(() => {
    rangeRef.current = null;
    setSelection(null);
    setForced(false);
  }, []);

  const refresh = useCallback(() => {
    const next = readSelection(host);
    if (!next) {
      // Focus moving into our own shadow UI can transiently drop the page
      // selection — don't tear the bubble down underneath the user.
      if (document.activeElement === host) return;
      clear();
      return;
    }
    rangeRef.current = next.range;
    setSelection(next.info);
    setDismissed(false);
  }, [host, clear]);

  /* Selection tracking (debounced). */
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, DEBOUNCE_MS);
    };
    document.addEventListener('selectionchange', schedule, true);
    document.addEventListener('mouseup', schedule, true);
    document.addEventListener('keyup', schedule, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', schedule, true);
      document.removeEventListener('mouseup', schedule, true);
      document.removeEventListener('keyup', schedule, true);
    };
  }, [refresh]);

  /* Follow the selection while the page scrolls / resizes; hide once it leaves. */
  useEffect(() => {
    if (!selection) return;
    let frame = 0;
    const reposition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const range = rangeRef.current;
        if (!range) return;
        const rect = rectOf(range);
        if (!rect || !isOnScreen(rect)) {
          clear();
          return;
        }
        setSelection((prev) => (prev ? { ...prev, rect } : prev));
      });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [selection, clear]);

  /* Escape dismisses the bubble. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  /* Background -> content requests. */
  useEffect(() => {
    const listener = (
      message: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ): undefined => {
      if (typeof message !== 'object' || message === null) return undefined;
      const type = (message as { type?: unknown }).type;
      if (type === 'GET_SELECTION') {
        sendResponse({ text: currentSelectionText(), title: document.title });
        return undefined;
      }
      if (type === 'SHOW_BUBBLE') {
        setForced(true);
        setDismissed(false);
        refresh();
      }
      return undefined;
    };

    try {
      chrome.runtime.onMessage.addListener(listener);
    } catch {
      return undefined;
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        /* context already gone */
      }
    };
  }, [refresh]);

  /* Mirror the theme preference onto the shadow host so tokens.css can react. */
  useEffect(() => {
    const root = host.shadowRoot?.querySelector('.n-root');
    if (settings.theme === 'system') {
      host.removeAttribute('data-theme');
      root?.removeAttribute('data-theme');
    } else {
      host.setAttribute('data-theme', settings.theme);
      root?.setAttribute('data-theme', settings.theme);
    }
  }, [host, settings.theme]);

  const handleRate = useCallback((next: number) => {
    setRateOverride(next);
    void api.setRate(next);
  }, []);

  const handlePlay = useCallback(() => {
    if (!selection) return;
    setDismissed(true);
    // Chunk locally with the same splitter the background uses, so the
    // broadcast chunkIndex maps onto offsets we can resolve in the DOM.
    chunksRef.current = chunkText(selection.text);
    if (rangeRef.current) highlighter.capture(rangeRef.current);
    void api.speak(selection.text, document.title);
  }, [selection]);

  /* Tint the sentence being spoken, in the page's own DOM. */
  useEffect(() => {
    if (!settings.highlightSpoken || state.status === 'idle' || state.status === 'error') {
      highlighter.clear();
      return;
    }
    const chunk = chunksRef.current[state.chunkIndex];
    if (chunk) highlighter.paint(chunk.start, chunk.end);
  }, [settings.highlightSpoken, state.status, state.chunkIndex]);

  /* Drop the highlight (and its anchors) once narration is over. */
  useEffect(() => {
    if (state.status === 'idle') {
      highlighter.reset();
      chunksRef.current = [];
    }
  }, [state.status]);

  const showBubble =
    !!selection && !dismissed && !active && (settings.showBubbleOnSelect || forced);

  return (
    <>
      {showBubble && selection ? (
        <SelectionBubble
          anchor={selection.rect}
          rate={rate}
          onRateChange={handleRate}
          onPlay={handlePlay}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
      {showPlayer ? <MiniPlayer state={state} rate={rate} onRateChange={handleRate} /> : null}
      <DrivePdfButton />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Mount                                                               */
/* ------------------------------------------------------------------ */

function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-live', 'off');
  // `all: initial` first, so the host page's CSS cannot reach us; the
  // declarations after it win because they come later in the same block.
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; ' +
    'margin: 0; padding: 0; border: 0; pointer-events: none; ' +
    'color-scheme: light dark; z-index: 2147483646;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `${tokens}\n${styles}`;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'n-root';
  shadow.appendChild(mountPoint);

  (document.documentElement ?? document.body).appendChild(host);

  createRoot(mountPoint).render(<ContentApp host={host} />);
}

function boot(): void {
  try {
    if (!document.documentElement) return;
    mount();
  } catch {
    /* never throw into the host page */
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
