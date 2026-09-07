/**
 * Web Speech API engine. Runs in the offscreen document because the
 * service worker has no `speechSynthesis`.
 */
import type { Chunk, Settings, VoiceOption } from '@/shared/types';

export interface SystemHandlers {
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Chrome silently stalls utterances after ~15s; nudge it before that. */
const KEEPALIVE_MS = 10_000;
const VOICES_TIMEOUT_MS = 2_000;

let keepAlive: number | null = null;
let userPaused = false;
/** Bumped by cancel()/speak() so stale utterance callbacks are ignored. */
let generation = 0;
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function rawVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  if (voicesPromise) return voicesPromise;

  // Chrome quirk: getVoices() is empty until the async list lands.
  voicesPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      const list = speechSynthesis.getVoices();
      if (!list.length) voicesPromise = null; // don't cache an empty answer
      resolve(list);
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    self.setTimeout(finish, VOICES_TIMEOUT_MS);
  });
  return voicesPromise;
}

export async function listVoices(): Promise<VoiceOption[]> {
  const voices = await rawVoices();
  return voices.map((v) => ({
    id: v.voiceURI,
    name: v.name,
    lang: v.lang,
    engine: 'system' as const,
    localService: v.localService,
  }));
}

async function pickVoice(settings: Settings): Promise<SpeechSynthesisVoice | null> {
  const voices = await rawVoices();
  if (!voices.length) return null;

  if (settings.systemVoiceId) {
    const exact = voices.find((v) => v.voiceURI === settings.systemVoiceId);
    if (exact) return exact;
  }
  const prefix = (navigator.language || 'en-US').slice(0, 2).toLowerCase();
  const matches = (v: SpeechSynthesisVoice): boolean => v.lang.slice(0, 2).toLowerCase() === prefix;
  return voices.find((v) => v.localService && matches(v)) ?? voices.find(matches) ?? voices[0];
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function startKeepAlive(): void {
  stopKeepAlive();
  keepAlive = self.setInterval(() => {
    if (userPaused || !speechSynthesis.speaking) return;
    speechSynthesis.resume();
  }, KEEPALIVE_MS);
}

function stopKeepAlive(): void {
  if (keepAlive !== null) {
    self.clearInterval(keepAlive);
    keepAlive = null;
  }
}

export function speak(chunk: Chunk, settings: Settings, handlers: SystemHandlers): void {
  const gen = ++generation;
  userPaused = false;

  void pickVoice(settings)
    .then((voice) => {
      if (gen !== generation) return; // cancelled while the voice list resolved

      const utterance = new SpeechSynthesisUtterance(chunk.text);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? navigator.language;
      // SpeechSynthesis only accepts 0.1–10; our UI range (0.5–3) fits inside.
      utterance.rate = clamp(settings.rate, 0.1, 10);
      utterance.pitch = clamp(settings.pitch, 0, 2);
      utterance.volume = clamp(settings.volume, 0, 1);

      utterance.onend = () => {
        if (gen !== generation) return;
        stopKeepAlive();
        handlers.onEnd();
      };
      utterance.onerror = (event) => {
        if (gen !== generation) return;
        stopKeepAlive();
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        handlers.onError(`Speech synthesis failed (${event.error})`);
      };

      speechSynthesis.cancel(); // clear anything the browser is still holding
      speechSynthesis.speak(utterance);
      startKeepAlive();
    })
    .catch((err: unknown) => {
      if (gen !== generation) return;
      handlers.onError(err instanceof Error ? err.message : 'Speech synthesis failed');
    });
}

export function pause(): void {
  userPaused = true;
  speechSynthesis.pause();
}

export function resume(): void {
  userPaused = false;
  speechSynthesis.resume();
}

export function cancel(): void {
  generation += 1;
  userPaused = false;
  stopKeepAlive();
  speechSynthesis.cancel();
}
