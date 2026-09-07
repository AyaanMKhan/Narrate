import { api } from '@/shared/messaging';
import type { PlaybackState } from '@/shared/types';

export interface PlayerCardProps {
  /** Live playback state broadcast by the background worker. */
  state: PlaybackState;
}

function IconPlay() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6.5 4.2 15.2 9.6a.5.5 0 0 1 0 .85L6.5 15.8a.5.5 0 0 1-.76-.43V4.63a.5.5 0 0 1 .76-.43Z" fill="currentColor" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5.5" y="4.5" width="3.2" height="11" rx="1.2" fill="currentColor" />
      <rect x="11.3" y="4.5" width="3.2" height="11" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5.5" y="5.5" width="9" height="9" rx="2" fill="currentColor" />
    </svg>
  );
}

function IconSkip({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      style={back ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M5.6 4.8 12.4 9.6a.5.5 0 0 1 0 .82L5.6 15.2a.5.5 0 0 1-.79-.41V5.21a.5.5 0 0 1 .79-.41Z" fill="currentColor" />
      <rect x="13.4" y="4.7" width="1.9" height="10.6" rx=".95" fill="currentColor" />
    </svg>
  );
}

function Spinner() {
  return <span className="n-spinner" aria-hidden="true" />;
}

export default function PlayerCard({ state }: PlayerCardProps) {
  const { status, title, chunkIndex, chunkCount, progress, error, modelProgress } = state;
  const active = status === 'playing' || status === 'paused' || status === 'loading';

  const retry = () => {
    if (state.text) void api.speak(state.text, state.title);
    else void api.speakPage();
  };

  if (status === 'error') {
    return (
      <div className="n-card n-player">
        <p className="n-player__error">{error ?? 'Something went wrong.'}</p>
        <div className="n-player__actions">
          <button type="button" className="n-btn n-btn--primary" onClick={retry}>
            Retry
          </button>
          <button
            type="button"
            className="n-btn n-btn--ghost"
            onClick={() => void api.stop()}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="n-card n-player">
        <button
          type="button"
          className="n-btn n-btn--primary n-btn--lg"
          onClick={() => void api.speakPage()}
        >
          <IconPlay />
          Narrate this page
        </button>
        <p className="n-player__hint">
          Or highlight text on any page — a Narrate bubble appears right where you
          selected.
        </p>
        <p className="n-player__hint n-player__hint--kbd">
          <kbd className="n-kbd">Alt</kbd>
          <kbd className="n-kbd">Shift</kbd>
          <kbd className="n-kbd">S</kbd>
          <span>reads the selection without leaving the keyboard.</span>
        </p>
      </div>
    );
  }

  const playing = status === 'playing';
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const counter = chunkCount > 0 ? `${Math.min(chunkIndex + 1, chunkCount)} / ${chunkCount}` : null;

  return (
    <div className="n-card n-player">
      <div className="n-player__meta">
        <p className="n-player__title" title={title || undefined}>
          {title || 'Untitled selection'}
        </p>
        {counter && <span className="n-player__counter">{counter}</span>}
      </div>

      <div
        className="n-progress"
        role="progressbar"
        aria-label="Narration progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="n-progress__fill" style={{ width: `${pct}%` }} />
      </div>

      {modelProgress !== null && (
        <div className="n-model">
          <div className="n-model__row">
            <Spinner />
            <span>Downloading neural voice… {Math.round(modelProgress * 100)}%</span>
          </div>
          <div
            className="n-progress n-progress--thin"
            role="progressbar"
            aria-label="Model download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(modelProgress * 100)}
          >
            <div
              className="n-progress__fill"
              style={{ width: `${Math.round(modelProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="n-transport">
        <button
          type="button"
          className="n-icon-btn"
          aria-label="Previous sentence"
          onClick={() => void api.skip(-1)}
        >
          <IconSkip back />
        </button>
        <button
          type="button"
          className="n-icon-btn n-icon-btn--primary"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={status === 'loading'}
          onClick={() => void (playing ? api.pause() : api.resume())}
        >
          {status === 'loading' ? <Spinner /> : playing ? <IconPause /> : <IconPlay />}
        </button>
        <button
          type="button"
          className="n-icon-btn"
          aria-label="Next sentence"
          onClick={() => void api.skip(1)}
        >
          <IconSkip />
        </button>
        <button
          type="button"
          className="n-icon-btn"
          aria-label="Stop"
          onClick={() => void api.stop()}
        >
          <IconStop />
        </button>
      </div>
    </div>
  );
}
