/**
 * Every PDF.js touch-point lives here, so the React layer only ever sees
 * plain DOM nodes and strings.
 *
 * The library ships inside the extension — MV3 forbids remote code — which
 * means the worker, the CMaps, the standard fonts and the wasm decoders are
 * all resolved through chrome.runtime.getURL().
 */
import * as pdfjs from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  PDF_CMAP_PATH,
  PDF_STANDARD_FONTS_PATH,
  PDF_WASM_PATH,
  PDF_WORKER_PATH,
} from '@/shared/constants';

export type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER_PATH);

/** 2× is already retina-crisp; beyond that we only burn canvas memory. */
const MAX_PIXEL_RATIO = 2;

export interface PageSize {
  width: number;
  height: number;
}

export interface RenderedPage {
  /** CSS pixels at the scale that was requested. */
  size: PageSize;
  /** The transparent, selectable layer sitting over the canvas. */
  textLayer: HTMLElement;
  /** One span per text item, in reading order. */
  textDivs: HTMLElement[];
}

interface PageTasks {
  render: RenderTask | null;
  layer: TextLayer | null;
}

/** In-flight work per page, so a re-render at a new scale can cancel the old one. */
const inFlight = new Map<number, PageTasks>();

/** PDF.js signals "you cancelled me" by throwing; that is not an error. */
function isAborted(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'RenderingCancelledException' || name === 'AbortException';
}

export async function loadDocument(source: ArrayBuffer | string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    ...(typeof source === 'string' ? { url: source } : { data: source }),
    cMapUrl: chrome.runtime.getURL(PDF_CMAP_PATH),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL(PDF_STANDARD_FONTS_PATH),
    wasmUrl: chrome.runtime.getURL(PDF_WASM_PATH),
    // Extension pages have no 'unsafe-eval': without this PDF.js throws while
    // compiling its font/expression helpers and nothing renders at all.
    isEvalSupported: false,
  });
  return task.promise;
}

/** Page dimensions at `scale`, used to size placeholders before we render. */
export async function getPageSize(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale = 1,
): Promise<PageSize> {
  const page = await doc.getPage(pageNumber);
  const { width, height } = page.getViewport({ scale });
  return { width, height };
}

/** Stop whatever is currently drawing this page. Safe to call at any time. */
export function cancelPage(pageNumber: number): void {
  const tasks = inFlight.get(pageNumber);
  if (!tasks) return;
  inFlight.delete(pageNumber);
  try {
    tasks.render?.cancel();
  } catch {
    /* task already settled */
  }
  try {
    tasks.layer?.cancel();
  } catch {
    /* text layer already settled */
  }
}

/** Drop a page's canvas so a long document never holds hundreds of bitmaps. */
export function releasePage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
): void {
  cancelPage(pageNumber);
  container.replaceChildren();
  void doc
    .getPage(pageNumber)
    .then((page) => page.cleanup())
    .catch(() => {
      /* page never finished loading — nothing to free */
    });
}

/**
 * Draw `pageNumber` into `container`: a canvas plus a transparent text layer
 * on top of it. Returns null when the render was superseded or cancelled.
 */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  scale: number,
): Promise<RenderedPage | null> {
  cancelPage(pageNumber);
  const tasks: PageTasks = { render: null, layer: null };
  inFlight.set(pageNumber, tasks);

  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

  const canvas = document.createElement('canvas');
  canvas.className = 'n-page__canvas';
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  // Bitmap is `ratio` times larger than the CSS box — that's the HiDPI win.
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) {
    inFlight.delete(pageNumber);
    return null;
  }

  const task = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
  });
  tasks.render = task;

  try {
    await task.promise;
  } catch (error: unknown) {
    if (isAborted(error)) return null;
    throw error;
  }

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'n-textlayer';
  // PDF.js positions every span with calc(var(--scale-factor) * …). Without
  // this property the text layer lays itself out at 1× and drifts off the page.
  textLayerDiv.style.setProperty('--scale-factor', String(scale));

  const layer = new TextLayer({
    textContentSource: await page.getTextContent(),
    container: textLayerDiv,
    viewport,
  });
  tasks.layer = layer;

  try {
    await layer.render();
  } catch (error: unknown) {
    if (isAborted(error)) return null;
    throw error;
  }

  // PDF.js marks a line end with a bare <br>, which holds no text node. Give
  // each one a newline so the DOM reads character-for-character like
  // extractPageText() and the highlighter's offsets land on the right words.
  for (const br of Array.from(textLayerDiv.querySelectorAll('br'))) {
    br.parentNode?.insertBefore(document.createTextNode('\n'), br);
  }

  // A newer render for this page started while we were awaiting — let it win.
  if (inFlight.get(pageNumber) !== tasks) return null;
  inFlight.delete(pageNumber);

  container.replaceChildren(canvas, textLayerDiv);
  return {
    size: { width: viewport.width, height: viewport.height },
    textLayer: textLayerDiv,
    textDivs: layer.textDivs,
  };
}

/**
 * The page's text, whitespace-collapsed. Built from the same items the text
 * layer renders, in the same order, so offsets into this string address the
 * same characters in the DOM.
 */
export async function extractPageText(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue; // marked-content marker, carries no text
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.replace(/\s+/g, ' ').trim();
}
