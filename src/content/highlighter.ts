/**
 * Tints the sentence currently being spoken, in the page's own DOM.
 *
 * Uses the CSS Custom Highlight API so we never mutate the host page —
 * no wrapper elements, no re-layout, nothing to clean up if we're torn
 * down mid-narration.
 */

const HIGHLIGHT_NAME = 'narrate-spoken';
const STYLE_ID = 'narrate-highlight-style';

/** Where the Nth character of the normalized text lives in the DOM. */
interface Anchor {
  node: Text;
  offset: number;
}

let anchors: Anchor[] = [];
let lastRange: Range | null = null;

export function isSupported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;
}

/**
 * Record where each character of `chunkText`'s normalized string sits in the
 * DOM. The whitespace collapsing here must match shared/chunk.ts exactly —
 * `text.replace(/\s+/g, ' ').trim()` — or the offsets won't line up.
 */
export function capture(range: Range): void {
  anchors = [];
  if (!isSupported()) return;

  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    },
  );

  let pendingSpace = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    // Clip the first and last nodes to the selection's own boundaries.
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;

    for (let i = from; i < to; i++) {
      const ch = node.data[i];
      if (/\s/.test(ch)) {
        if (anchors.length) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        anchors.push({ node, offset: i });
        pendingSpace = false;
      }
      anchors.push({ node, offset: i });
    }
    node = walker.nextNode() as Text | null;
  }
}

/** Paint the half-open normalized range [start, end). */
export function paint(start: number, end: number): void {
  if (!isSupported() || !anchors.length) return;

  const first = anchors[Math.max(0, Math.min(start, anchors.length - 1))];
  const last = anchors[Math.max(0, Math.min(end, anchors.length) - 1)];
  if (!first || !last) return;

  try {
    ensureStyle();
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.offset + 1, last.node.data.length));
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    lastRange = range;
  } catch {
    // Nodes can be replaced by the page (SPA re-render) between chunks.
    clear();
  }
}

/** Scroll the last painted range into view if it's clipped by the viewport. */
export function ensureVisible(): void {
  if (!lastRange || !isSupported()) return;

  const rect = lastRange.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;

  try {
    const container = lastRange.startContainer;
    const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as Element);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    // Nodes can be replaced by the page (SPA re-render) between chunks.
  }
}

export function clear(): void {
  if (!isSupported()) return;
  try {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  } catch {
    /* registry already gone */
  }
  lastRange = null;
}

export function reset(): void {
  clear();
  anchors = [];
}

/**
 * ::highlight() styles the page's own text, so this rule has to live in the
 * page document — a shadow-root stylesheet would never reach it.
 */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background-color: rgba(109, 94, 252, 0.24);
      color: inherit;
    }
    @media (prefers-color-scheme: dark) {
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: rgba(139, 123, 255, 0.34);
      }
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}
