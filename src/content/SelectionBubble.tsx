import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BRAND, SPEEDS } from '@/shared/constants';

/** Viewport-space rectangle of the thing we are anchored to. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const MARGIN = 8;
const GAP = 10;

export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/* ------------------------------------------------------------------ */
/* Speed control — shared by the bubble and the mini player            */
/* ------------------------------------------------------------------ */

export interface SpeedControlProps {
  rate: number;
  onChange: (rate: number) => void;
  /** Which way the menu opens. */
  placement?: 'up' | 'down';
  /** Visual weight: the bubble chip is airier than the player's. */
  tone?: 'ghost' | 'sunken';
}

export function SpeedControl({
  rate,
  onChange,
  placement = 'up',
  tone = 'ghost',
}: SpeedControlProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const current = menuRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]');
    (current ?? menuRef.current?.querySelector<HTMLButtonElement>('button'))?.focus();

    // A fixed-position scrim is useless here: our panels use backdrop-filter,
    // which makes them the containing block for fixed descendants. Watch the
    // real event path instead so clicks anywhere (page or shadow) close us.
    const onPointerDown = (event: Event) => {
      const path = event.composedPath();
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if ((menu && path.includes(menu)) || (trigger && path.includes(trigger))) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  return (
    <div className="n-speed">
      <button
        ref={triggerRef}
        type="button"
        className={`n-chip n-chip--${tone}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Playback speed, currently ${formatRate(rate)}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="n-chip__value">{formatRate(rate)}</span>
        <svg className="n-chip__caret" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1.5 5 5l4-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          ref={menuRef}
          className={`n-menu n-menu--${placement}`}
          role="menu"
          aria-label="Playback speed"
        >
          {SPEEDS.map((speed) => {
            const isCurrent = Math.abs(speed - rate) < 0.001;
            return (
              <button
                key={speed}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                data-current={isCurrent}
                className="n-menu__item"
                onClick={() => {
                  onChange(speed);
                  close(true);
                }}
              >
                {formatRate(speed)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The bubble                                                          */
/* ------------------------------------------------------------------ */

export interface SelectionBubbleProps {
  anchor: AnchorRect;
  rate: number;
  onRateChange: (rate: number) => void;
  onPlay: () => void;
  onDismiss: () => void;
}

interface Placement {
  left: number;
  top: number;
  side: 'top' | 'bottom';
}

export function SelectionBubble({
  anchor,
  rate,
  onRateChange,
  onPlay,
  onDismiss,
}: SelectionBubbleProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const centre = (anchor.left + anchor.right) / 2;
    const left = Math.min(Math.max(centre - width / 2, MARGIN), Math.max(MARGIN, vw - width - MARGIN));

    const above = anchor.top - height - GAP;
    const below = anchor.bottom + GAP;
    const fitsAbove = above >= MARGIN;
    const side: Placement['side'] = fitsAbove ? 'top' : 'bottom';
    const top = fitsAbove ? above : Math.min(below, Math.max(MARGIN, vh - height - MARGIN));

    setPlacement({ left: Math.round(left), top: Math.round(top), side });
  }, [anchor.top, anchor.bottom, anchor.left, anchor.right]);

  return (
    <div
      ref={ref}
      className={`n-bubble${placement ? ` n-bubble--${placement.side} n-bubble--ready` : ''}`}
      style={{ left: `${placement?.left ?? 0}px`, top: `${placement?.top ?? 0}px` }}
      role="dialog"
      aria-label={`${BRAND.name} — narrate selection`}
      // Keep the page selection alive when the bubble is clicked.
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDismiss();
      }}
    >
      <button type="button" className="n-bubble__play" onClick={onPlay} aria-label="Narrate selection">
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M4.4 2.6a.7.7 0 0 1 1.06-.6l5.4 4.4a.7.7 0 0 1 0 1.2l-5.4 4.4a.7.7 0 0 1-1.06-.6z" fill="currentColor" />
        </svg>
      </button>

      <button type="button" className="n-bubble__label" onClick={onPlay}>
        {BRAND.name}
      </button>

      <span className="n-bubble__divider" aria-hidden="true" />

      <SpeedControl rate={rate} onChange={onRateChange} placement="down" tone="ghost" />
    </div>
  );
}
