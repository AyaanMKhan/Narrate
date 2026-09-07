import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { api } from '@/shared/messaging';
import { BRAND } from '@/shared/constants';
import type { PlaybackState } from '@/shared/types';
import { SpeedControl } from './SelectionBubble';

const EDGE = 20;

export interface MiniPlayerProps {
  state: PlaybackState;
  rate: number;
  onRateChange: (rate: number) => void;
}

interface Position {
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/* --------------------------- icons --------------------------- */

function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2a.7.7 0 0 1 1.07-.6l6.1 4.8a.7.7 0 0 1 0 1.2l-6.1 4.8A.7.7 0 0 1 5 12.8z" fill="currentColor" />
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
    <svg viewBox="0 0 16 16" aria-hidden="true" style={back ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M4 4.1a.6.6 0 0 1 .93-.5l5.3 3.4a.6.6 0 0 1 0 1l-5.3 3.4a.6.6 0 0 1-.93-.5z" fill="currentColor" />
      <rect x="11" y="3.4" width="1.7" height="9.2" rx=".85" fill="currentColor" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true" className="n-mini__grip">
      <g fill="currentColor">
        <circle cx="4" cy="5" r="1.1" />
        <circle cx="8" cy="5" r="1.1" />
        <circle cx="4" cy="8" r="1.1" />
        <circle cx="8" cy="8" r="1.1" />
        <circle cx="4" cy="11" r="1.1" />
        <circle cx="8" cy="11" r="1.1" />
      </g>
    </svg>
  );
}

/* --------------------------- player --------------------------- */

export function MiniPlayer({ state, rate, onRateChange }: MiniPlayerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);

  const isLoading = state.status === 'loading';
  const isPlaying = state.status === 'playing';
  const isError = state.status === 'error';
  const hasChunks = state.chunkCount > 0;

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || event.button !== 0) return;
    if ((event.target as Element).closest('button')) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    setPosition({ left: rect.left, top: rect.top });
    setDragging(true);
    event.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const el = ref.current;
      const offset = dragRef.current;
      if (!el || !offset) return;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      setPosition({
        left: clamp(event.clientX - offset.dx, 8, window.innerWidth - width - 8),
        top: clamp(event.clientY - offset.dy, 8, window.innerHeight - height - 8),
      });
    };
    const end = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
  }, [dragging]);

  // Keep the player on screen if the viewport shrinks under a dragged position.
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      setPosition((prev) =>
        prev
          ? {
              left: clamp(prev.left, 8, window.innerWidth - el.offsetWidth - 8),
              top: clamp(prev.top, 8, window.innerHeight - el.offsetHeight - 8),
            }
          : prev,
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const style: CSSProperties = position
    ? { left: `${position.left}px`, top: `${position.top}px` }
    : { right: `${EDGE}px`, bottom: `${EDGE}px` };

  const progressPct = Math.round(clamp(state.progress, 0, 1) * 100);
  const title = state.title || state.text.slice(0, 80) || BRAND.name;

  return (
    <div
      ref={ref}
      className={`n-mini${dragging ? ' n-mini--dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label={`${BRAND.name} player`}
    >
      <div
        className={`n-progress${isLoading ? ' n-progress--indeterminate' : ''}`}
        role="progressbar"
        aria-label="Narration progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isLoading ? undefined : progressPct}
      >
        <div className="n-progress__fill" style={isLoading ? undefined : { width: `${progressPct}%` }} />
      </div>

      <div className="n-mini__header" onPointerDown={onPointerDown}>
        <IconGrip />
        <div className="n-mini__titles">
          <div className="n-mini__title" title={title}>
            {title}
          </div>
          <div className="n-mini__meta">
            {isError ? (
              <span className="n-mini__error">{state.error ?? 'Something went wrong'}</span>
            ) : isLoading ? (
              <span>
                {state.modelProgress !== null
                  ? `Downloading voice… ${Math.round(state.modelProgress * 100)}%`
                  : 'Warming up…'}
              </span>
            ) : (
              <>
                <span className="n-mini__dot" data-playing={isPlaying} aria-hidden="true" />
                <span>{isPlaying ? 'Playing' : 'Paused'}</span>
                {hasChunks ? (
                  <span className="n-mini__count">
                    {Math.min(state.chunkIndex + 1, state.chunkCount)} / {state.chunkCount}
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
        <button type="button" className="n-icon n-icon--quiet" aria-label="Stop narration" onClick={() => void api.stop()}>
          <IconClose />
        </button>
      </div>

      <div className="n-mini__controls">
        {isError ? (
          <button type="button" className="n-retry" onClick={() => void api.speak(state.text, state.title)}>
            Try again
          </button>
        ) : (
          <>
            <button
              type="button"
              className="n-icon"
              aria-label="Previous sentence"
              disabled={!hasChunks}
              onClick={() => void api.skip(-1)}
            >
              <IconSkip back />
            </button>

            <button
              type="button"
              className="n-primary"
              aria-label={isPlaying ? 'Pause narration' : 'Resume narration'}
              disabled={isLoading}
              onClick={() => void (isPlaying ? api.pause() : api.resume())}
            >
              {isPlaying ? <IconPause /> : <IconPlay />}
            </button>

            <button
              type="button"
              className="n-icon"
              aria-label="Next sentence"
              disabled={!hasChunks}
              onClick={() => void api.skip(1)}
            >
              <IconSkip />
            </button>
          </>
        )}

        <div className="n-mini__spacer" />
        <SpeedControl rate={rate} onChange={onRateChange} placement="up" tone="sunken" />
      </div>
    </div>
  );
}
