import { useCallback, useEffect, useState } from 'react';
import { BRAND } from '@/shared/constants';
import { api } from '@/shared/messaging';
import {
  DEFAULT_SETTINGS,
  INITIAL_STATE,
  type EngineId,
  type PlaybackState,
  type Settings,
  type VoiceOption,
} from '@/shared/types';
import PlayerCard from './components/PlayerCard';
import SpeedPicker from './components/SpeedPicker';
import Toggle from './components/Toggle';
import VoicePicker from './components/VoicePicker';

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

type Theme = Settings['theme'];

const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];

const THEME_LABEL: Record<Theme, string> = {
  system: 'Match system theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="3.6" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4M15.8 15.8l-1.4-1.4M5.6 5.6 4.2 4.2" />
        </g>
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M16.2 12.4A6.8 6.8 0 0 1 7.6 3.8a6.9 6.9 0 1 0 8.6 8.6Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect
        x="2.4"
        y="4.2"
        width="15.2"
        height="10.4"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M7 17.2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Wordmark() {
  return (
    <svg
      className="n-wordmark__glyph"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M3 8.6v2.8" />
        <path d="M6.7 5.8v8.4" />
        <path d="M10.4 3.4v13.2" />
        <path d="M14.1 6.6v6.8" />
        <path d="M17.6 9v2" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Engine cards                                                        */
/* ------------------------------------------------------------------ */

interface EngineChoice {
  id: EngineId;
  title: string;
  subtitle: string;
}

const ENGINES: EngineChoice[] = [
  {
    id: 'system',
    title: 'System voices',
    subtitle: 'Instant · offline · built into your device',
  },
  {
    id: 'kokoro',
    title: 'Neural (Kokoro)',
    subtitle: 'Natural AI voice · free · runs on-device',
  },
];

function Check() {
  return (
    <svg className="n-engine__check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path
        d="m4.6 8.2 2.2 2.2 4.6-4.6"
        fill="none"
        stroke="var(--n-accent-text)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* PDFs                                                                */
/* ------------------------------------------------------------------ */

function PdfIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.8 1.7h4.6l3.8 3.8v8.8H3.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M8.4 1.7v3.8h3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M6 9.2h4M6 11.4h2.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Popup                                                               */
/* ------------------------------------------------------------------ */

export default function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  /* Assume granted until the worker says otherwise, so the notice never flashes. */
  const [fileAccess, setFileAccess] = useState(true);
  const [copied, setCopied] = useState(false);

  /* Seed from the background, tolerating a worker that hasn't woken yet. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [nextSettings, nextState, nextVoices, allowsFiles] = await Promise.all([
        api.getSettings(),
        api.getState(),
        api.getVoices(),
        api.getFileAccess(),
      ]);
      if (!alive) return;
      if (nextSettings) setSettings(nextSettings);
      if (nextState) setState(nextState);
      if (Array.isArray(nextVoices)) setVoices(nextVoices);
      setFileAccess(allowsFiles !== false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* Stay in sync while the popup is open. */
  useEffect(() => {
    const listener = (message: unknown): void => {
      if (typeof message !== 'object' || message === null) return;
      const msg = message as { type?: string; state?: PlaybackState; settings?: Settings };
      if (msg.type === 'STATE' && msg.state) setState(msg.state);
      else if (msg.type === 'SETTINGS' && msg.settings) setSettings(msg.settings);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  /** Optimistic local update + persist. */
  const patch = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    void api.saveSettings(partial);
  }, []);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length];
    patch({ theme: next });
  };

  const onRate = (rate: number) => {
    setSettings((prev) => ({ ...prev, rate }));
    setState((prev) => ({ ...prev, rate }));
    void api.setRate(rate);
  };

  const onEngine = (engine: EngineId) => {
    if (engine === settings.engine) return;
    setSettings((prev) => ({ ...prev, engine }));
    void api.setEngine(engine);
  };

  /* A page can't navigate to chrome://, so hand the user the link to paste. */
  const copySettingsLink = () => {
    void navigator.clipboard
      .writeText(`chrome://extensions/?id=${chrome.runtime.id}`)
      .then(() => setCopied(true))
      .catch(() => {
        /* clipboard denied — the notice still names the page */
      });
  };

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onVoice = (voiceId: string, engine: EngineId) => {
    setSettings((prev) =>
      engine === 'kokoro'
        ? { ...prev, kokoroVoiceId: voiceId }
        : { ...prev, systemVoiceId: voiceId },
    );
    void api.setVoice(voiceId, engine);
  };

  return (
    <div className="n-popup">
      <header className="n-header">
        <div className="n-wordmark">
          <div className="n-wordmark__row">
            <Wordmark />
            <span className="n-wordmark__name">{BRAND.name}</span>
          </div>
          <p className="n-wordmark__tagline">{BRAND.tagline}</p>
        </div>
        <button
          type="button"
          className="n-icon-btn n-icon-btn--sm"
          onClick={cycleTheme}
          aria-label={THEME_LABEL[settings.theme]}
          title={THEME_LABEL[settings.theme]}
        >
          <ThemeIcon theme={settings.theme} />
        </button>
      </header>

      <main className="n-body">
        <PlayerCard state={state} />

        <SpeedPicker value={settings.rate} onChange={onRate} />

        <section className="n-section">
          <div className="n-section__head">
            <h2 className="n-label">Engine</h2>
          </div>
          <div className="n-engines" role="radiogroup" aria-label="Speech engine">
            {ENGINES.map((engine) => {
              const active = settings.engine === engine.id;
              return (
                <button
                  key={engine.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`n-engine${active ? ' is-active' : ''}`}
                  onClick={() => onEngine(engine.id)}
                >
                  {active && <Check />}
                  <span className="n-engine__title">{engine.title}</span>
                  <span className="n-engine__subtitle">{engine.subtitle}</span>
                </button>
              );
            })}
          </div>
          <p className="n-note">
            First use downloads ~80 MB once, then works offline. No account, no API key.
          </p>
        </section>

        <VoicePicker
          engine={settings.engine}
          voices={voices}
          systemVoiceId={settings.systemVoiceId}
          kokoroVoiceId={settings.kokoroVoiceId}
          onChange={onVoice}
        />

        <section className="n-section">
          <div className="n-section__head">
            <h2 className="n-label">PDFs</h2>
          </div>

          <button
            type="button"
            className="n-btn n-btn--lg"
            onClick={() => void api.openPdfViewer()}
          >
            <PdfIcon />
            Open a PDF…
          </button>

          <div className="n-rows">
            <div className="n-row">
              <div className="n-row__text">
                <span className="n-row__title">Open PDFs in Narrate</span>
                <span className="n-row__desc" id="n-desc-pdf">
                  Chrome’s PDF viewer hides its text from extensions, so Narrate uses its
                  own reader.
                </span>
              </div>
              <Toggle
                checked={settings.openPdfsInNarrate}
                onChange={(next) => patch({ openPdfsInNarrate: next })}
                label="Open PDFs in Narrate"
                describedBy="n-desc-pdf"
              />
            </div>
          </div>

          {!fileAccess && (
            <div className="n-notice">
              <p className="n-notice__text">
                To read PDFs stored on your computer, enable “Allow access to file URLs”
                for Narrate on chrome://extensions.
              </p>
              <button
                type="button"
                className="n-btn n-btn--sm n-notice__action"
                onClick={copySettingsLink}
              >
                {copied ? 'Copied' : 'Copy settings link'}
              </button>
            </div>
          )}
        </section>

        <section className="n-section">
          <div className="n-section__head">
            <h2 className="n-label">Preferences</h2>
          </div>

          <div className="n-rows">
            <div className="n-row">
              <div className="n-row__text">
                <span className="n-row__title">Show bubble when I highlight text</span>
                <span className="n-row__desc" id="n-desc-bubble">
                  A small play button follows your selection on any page.
                </span>
              </div>
              <Toggle
                checked={settings.showBubbleOnSelect}
                onChange={(next) => patch({ showBubbleOnSelect: next })}
                label="Show bubble when I highlight text"
                describedBy="n-desc-bubble"
              />
            </div>

            <div className="n-row">
              <div className="n-row__text">
                <span className="n-row__title">Highlight the sentence being read</span>
                <span className="n-row__desc" id="n-desc-highlight">
                  Tints each sentence on the page as it is spoken.
                </span>
              </div>
              <Toggle
                checked={settings.highlightSpoken}
                onChange={(next) => patch({ highlightSpoken: next })}
                label="Highlight the sentence being read"
                describedBy="n-desc-highlight"
              />
            </div>
          </div>

          <div className="n-slider">
            <label className="n-slider__head" htmlFor="n-pitch">
              <span className="n-row__title">Pitch</span>
              <span className="n-label__value">{settings.pitch.toFixed(1)}</span>
            </label>
            <input
              id="n-pitch"
              className="n-range"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.pitch}
              onChange={(event) => patch({ pitch: Number(event.target.value) })}
            />
          </div>

          <div className="n-slider">
            <label className="n-slider__head" htmlFor="n-volume">
              <span className="n-row__title">Volume</span>
              <span className="n-label__value">{Math.round(settings.volume * 100)}%</span>
            </label>
            <input
              id="n-volume"
              className="n-range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(event) => patch({ volume: Number(event.target.value) })}
            />
          </div>
        </section>
      </main>

      <footer className="n-footer">
        100% free · runs on your device · nothing leaves your browser.
      </footer>
    </div>
  );
}
