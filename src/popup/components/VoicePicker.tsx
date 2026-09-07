import { useMemo } from 'react';
import { KOKORO_VOICES } from '@/shared/constants';
import { api } from '@/shared/messaging';
import type { EngineId, VoiceOption } from '@/shared/types';

const PREVIEW_TEXT = 'Narrate reads any text aloud, at whatever speed you like.';

export interface VoicePickerProps {
  /** Engine whose voices should be listed. */
  engine: EngineId;
  /** All voices reported by the background (system engine). */
  voices: VoiceOption[];
  /** Selected system voice id, if any. */
  systemVoiceId: string | null;
  /** Selected Kokoro voice id. */
  kokoroVoiceId: string;
  /** Called with the chosen voice id and the engine it belongs to. */
  onChange: (voiceId: string, engine: EngineId) => void;
}

interface VoiceGroup {
  lang: string;
  voices: VoiceOption[];
}

/** Turn "en-US" into a readable-ish group heading, falling back to the tag. */
function langLabel(lang: string): string {
  if (!lang) return 'Other';
  try {
    const display = new Intl.DisplayNames([navigator.language], { type: 'language' });
    return display.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

export default function VoicePicker({
  engine,
  voices,
  systemVoiceId,
  kokoroVoiceId,
  onChange,
}: VoicePickerProps) {
  const systemGroups = useMemo<VoiceGroup[]>(() => {
    const byLang = new Map<string, VoiceOption[]>();
    for (const voice of voices) {
      if (voice.engine !== 'system') continue;
      const key = voice.lang || 'Other';
      const bucket = byLang.get(key);
      if (bucket) bucket.push(voice);
      else byLang.set(key, [voice]);
    }
    return [...byLang.entries()]
      .map(([lang, list]) => ({ lang, voices: list }))
      .sort((a, b) => a.lang.localeCompare(b.lang));
  }, [voices]);

  const isSystem = engine === 'system';
  const value = isSystem ? (systemVoiceId ?? '') : kokoroVoiceId;
  const empty = isSystem && systemGroups.length === 0;

  return (
    <section className="n-section">
      <div className="n-section__head">
        <h2 className="n-label" id="n-voice-label">
          Voice
        </h2>
      </div>
      <div className="n-voice-row">
        <div className="n-select-wrap">
          <select
            className="n-select"
            aria-labelledby="n-voice-label"
            value={value}
            disabled={empty}
            onChange={(event) => onChange(event.target.value, engine)}
          >
            {isSystem ? (
              <>
                {systemVoiceId === null && (
                  <option value="">System default</option>
                )}
                {systemGroups.map((group) => (
                  <optgroup key={group.lang} label={langLabel(group.lang)}>
                    {group.voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                        {voice.localService ? ' · offline' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {empty && <option value="">Loading voices…</option>}
              </>
            ) : (
              KOKORO_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {`${voice.name} (${voice.lang})`}
                </option>
              ))
            )}
          </select>
          <svg
            className="n-select__chevron"
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3 4.5 6 7.5 9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <button
          type="button"
          className="n-btn n-btn--ghost n-btn--sm"
          onClick={() => void api.speak(PREVIEW_TEXT, 'Voice preview')}
        >
          Preview
        </button>
      </div>
    </section>
  );
}
