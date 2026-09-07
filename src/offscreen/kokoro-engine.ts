/**
 * Kokoro-82M neural engine — 100% on-device via kokoro-js / transformers.js.
 * No API key, no network beyond the one-time model download.
 */
import { KOKORO_MODEL_ID, KOKORO_VOICES } from '@/shared/constants';
import type { Chunk, Settings, VoiceOption } from '@/shared/types';

export interface KokoroHandlers {
  /** Fired once audio actually starts, so the UI can leave 'loading'. */
  onStart: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onModelProgress: (progress: number) => void;
}

/** Structural view of kokoro-js, so a string voice id doesn't fight its literal union. */
interface RawAudioLike {
  toBlob?: () => Blob;
  toWav?: () => ArrayBuffer;
  audio?: Float32Array;
  sampling_rate?: number;
}
interface KokoroLike {
  generate(text: string, options: { voice?: string; speed?: number }): Promise<RawAudioLike>;
}
interface KokoroCtor {
  from_pretrained(modelId: string, options: Record<string, unknown>): Promise<KokoroLike>;
}

export const UNAVAILABLE = 'Neural voice unavailable — falling back to system voices';

let model: KokoroLike | null = null;
let loading: Promise<KokoroLike> | null = null;
/** Bumped by cancel()/speak() so stale async callbacks are ignored. */
let generation = 0;
let objectUrl: string | null = null;

export function listVoices(): VoiceOption[] {
  return KOKORO_VOICES.map((v) => ({
    id: v.id,
    name: v.name,
    lang: v.lang,
    engine: 'kokoro' as const,
  }));
}

function reason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'unknown error';
}

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** transformers.js reports `{ status, file, progress: 0..100, loaded, total }`. */
function readProgress(info: unknown): number | null {
  if (typeof info !== 'object' || info === null) return null;
  const rec = info as { status?: unknown; progress?: unknown; loaded?: unknown; total?: unknown };
  if (typeof rec.progress === 'number' && Number.isFinite(rec.progress)) {
    return Math.min(1, Math.max(0, rec.progress / 100));
  }
  if (typeof rec.loaded === 'number' && typeof rec.total === 'number' && rec.total > 0) {
    return Math.min(1, Math.max(0, rec.loaded / rec.total));
  }
  if (rec.status === 'done' || rec.status === 'ready') return 1;
  return null;
}

async function loadModel(onProgress: (progress: number) => void): Promise<KokoroLike> {
  // Imported lazily so the popup and the system engine never pay for it.
  const { KokoroTTS } = await import('kokoro-js');
  const ctor = KokoroTTS as unknown as KokoroCtor;

  const accelerated = await hasWebGPU();
  const options: Record<string, unknown> = accelerated
    ? { dtype: 'fp32', device: 'webgpu' }
    : { dtype: 'q8', device: 'wasm' };

  const withProgress: Record<string, unknown> = {
    ...options,
    progress_callback: (info: unknown) => {
      const p = readProgress(info);
      if (p !== null) onProgress(p);
    },
  };

  try {
    return await ctor.from_pretrained(KOKORO_MODEL_ID, withProgress);
  } catch {
    // Some builds reject unknown options — retry without progress reporting.
    return await ctor.from_pretrained(KOKORO_MODEL_ID, options);
  }
}

export async function ensureModel(onProgress: (progress: number) => void): Promise<KokoroLike> {
  if (model) return model;
  if (loading) return loading;

  loading = loadModel(onProgress)
    .then((loaded) => {
      model = loaded;
      return loaded;
    })
    .catch((err: unknown) => {
      throw new Error(`${UNAVAILABLE} (${reason(err)})`);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Minimal 16-bit PCM WAV writer, used only if kokoro-js hands back raw samples. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function toBlob(audio: RawAudioLike): Blob {
  if (typeof audio.toBlob === 'function') return audio.toBlob();
  if (typeof audio.toWav === 'function') return new Blob([audio.toWav()], { type: 'audio/wav' });
  if (audio.audio && typeof audio.sampling_rate === 'number') {
    return new Blob([encodeWav(audio.audio, audio.sampling_rate)], { type: 'audio/wav' });
  }
  throw new Error(`${UNAVAILABLE} (unrecognized audio format)`);
}

function getPlayer(): HTMLAudioElement {
  const existing = document.getElementById('player');
  if (existing instanceof HTMLAudioElement) return existing;
  const created = document.createElement('audio');
  created.id = 'player';
  created.hidden = true;
  document.body.appendChild(created);
  return created;
}

function releaseUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function speak(chunk: Chunk, settings: Settings, handlers: KokoroHandlers): void {
  const gen = ++generation;

  void (async () => {
    const tts = await ensureModel(handlers.onModelProgress);
    if (gen !== generation) return;

    const audio = await tts.generate(chunk.text, { voice: settings.kokoroVoiceId });
    if (gen !== generation) return;

    const player = getPlayer();
    releaseUrl();
    objectUrl = URL.createObjectURL(toBlob(audio));
    player.src = objectUrl;
    player.playbackRate = clamp(settings.rate, 0.0625, 16);
    player.volume = clamp(settings.volume, 0, 1);
    player.onended = () => {
      if (gen !== generation) return;
      handlers.onEnd();
    };
    player.onerror = () => {
      if (gen !== generation) return;
      handlers.onError('Could not play the synthesized audio');
    };

    await player.play();
    if (gen !== generation) return;
    handlers.onStart();
  })().catch((err: unknown) => {
    if (gen !== generation) return;
    handlers.onError(reason(err));
  });
}

export function setRate(rate: number): void {
  const player = getPlayer();
  player.playbackRate = clamp(rate, 0.0625, 16);
}

export function pause(): void {
  getPlayer().pause();
}

export function resume(): void {
  void getPlayer()
    .play()
    .catch(() => {
      /* nothing loaded yet — the sequencer will start the next chunk */
    });
}

export function cancel(): void {
  generation += 1;
  const player = getPlayer();
  player.onended = null;
  player.onerror = null;
  player.pause();
  player.removeAttribute('src');
  player.load();
  releaseUrl();
}
