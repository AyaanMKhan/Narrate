/**
 * Faintly tints passages waiting in the narration queue, so it's visible on the
 * page what will be read next. Same CSS Custom Highlight approach as
 * highlighter.ts — the host page's DOM is never touched.
 */

const HIGHLIGHT_NAME = 'narrate-queued';
const STYLE_ID = 'narrate-queued-style';

function isSupported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;
}

/** Replace the marked set with exactly these ranges. */
export function show(ranges: Range[]): void {
  if (!isSupported()) return;
  try {
    if (!ranges.length) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    ensureStyle();
    const highlight = new Highlight(...ranges);
    // Below the spoken-text tint, should the two ever overlap.
    highlight.priority = -1;
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  } catch {
    /* registry unavailable or ranges detached by the page */
  }
}

export function clear(): void {
  show([]);
}

/** ::highlight() must be styled from the page document, not our shadow root. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      /* Fainter than the spoken tint. (Chromium draws highlight underlines
         with a stray solid line under them, so a tint it is.) */
      background-color: rgba(109, 94, 252, 0.09);
      color: inherit;
    }
    @media (prefers-color-scheme: dark) {
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: rgba(139, 123, 255, 0.14);
      }
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}
