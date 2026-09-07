/**
 * Offscreen audio document: routes OffscreenCommands and sequences the
 * chunk queue through whichever engine is selected.
 */
import * as kokoro from './kokoro-engine';
import * as system from './system-engine';
import {
  DEFAULT_SETTINGS,
  type Chunk,
  type EngineId,
  type OffscreenCommand,
  type OffscreenEvent,
  type PlaybackStatus,
  type Settings,
  type VoiceOption,
} from '@/shared/types';

let queue: Chunk[] = [];
/** Array position inside `queue` — Chunk.index is the global id we report. */
let position = 0;
let settings: Settings = { ...DEFAULT_SETTINGS };
let engine: EngineId = DEFAULT_SETTINGS.engine;
let status: PlaybackStatus = 'idle';
/** Bumped on stop/seek/next so stale engine callbacks are dropped. */
let playToken = 0;
/** Carried into the next status so a silent engine fallback is still visible. */
let fallbackNote: string | null = null;

function emit(event: OffscreenEvent): void {
  try {
    void chrome.runtime.sendMessage(event)?.catch?.(() => {});
  } catch {
    /* service worker asleep or context torn down — nothing to do */
  }
}

function setStatus(next: PlaybackStatus): void {
  status = next;
  const note = fallbackNote;
  fallbackNote = null;
  emit(note ? { type: 'OFF_STATUS', status: next, error: note } : { type: 'OFF_STATUS', status: next });
}

function stopEngines(): void {
  system.cancel();
  kokoro.cancel();
}

function finish(): void {
  playToken += 1;
  stopEngines();
  queue = [];
  position = 0;
  status = 'idle';
  emit({ type: 'OFF_DONE' });
}

function advance(): void {
  position += 1;
  if (position >= queue.length) {
    finish();
    return;
  }
  playCurrent();
}

function onEngineError(message: string): void {
  if (engine === 'kokoro') {
    // Neural engine died (offline, WebGPU crash) — keep reading via the OS voices.
    engine = 'system';
    settings = { ...settings, engine: 'system' };
    fallbackNote = message;
    playCurrent();
    return;
  }
  playToken += 1;
  stopEngines();
  status = 'error';
  emit({ type: 'OFF_STATUS', status: 'error', error: message });
}

function playCurrent(): void {
  const chunk = queue[position];
  if (!chunk) {
    finish();
    return;
  }
  const token = ++playToken;
  stopEngines();
  emit({ type: 'OFF_CHUNK', chunkIndex: chunk.index });

  const guard = (fn: () => void) => () => {
    if (token === playToken) fn();
  };

  if (engine === 'kokoro') {
    setStatus('loading');
    kokoro.speak(chunk, settings, {
      onStart: guard(() => setStatus('playing')),
      onEnd: guard(advance),
      onModelProgress: (progress) => emit({ type: 'OFF_MODEL_PROGRESS', progress }),
      onError: (message) => {
        if (token !== playToken) return;
        onEngineError(message);
      },
    });
    return;
  }

  setStatus('playing');
  system.speak(chunk, settings, {
    onEnd: guard(advance),
    onError: (message) => {
      if (token !== playToken) return;
      onEngineError(message);
    },
  });
}

function startAt(index: number): void {
  if (index < 0 || index >= queue.length) {
    finish();
    return;
  }
  position = index;
  playCurrent();
}

async function allVoices(): Promise<VoiceOption[]> {
  const sys = await system.listVoices().catch(() => [] as VoiceOption[]);
  return [...sys, ...kokoro.listVoices()];
}

function handle(command: OffscreenCommand, sendResponse: (response?: unknown) => void): boolean {
  switch (command.type) {
    case 'OFF_SPEAK':
      settings = command.settings;
      engine = command.settings.engine;
      queue = command.chunks;
      playToken += 1;
      stopEngines();
      startAt(0);
      sendResponse(true);
      return false;

    case 'OFF_PAUSE':
      if (engine === 'kokoro') kokoro.pause();
      else system.pause();
      setStatus('paused');
      sendResponse(true);
      return false;

    case 'OFF_RESUME':
      if (engine === 'kokoro') kokoro.resume();
      else system.resume();
      setStatus('playing');
      sendResponse(true);
      return false;

    case 'OFF_STOP':
      playToken += 1;
      stopEngines();
      queue = [];
      position = 0;
      setStatus('idle');
      sendResponse(true);
      return false;

    case 'OFF_SEEK': {
      const found = queue.findIndex((c) => c.index === command.chunkIndex);
      playToken += 1;
      stopEngines();
      startAt(found === -1 ? Math.min(Math.max(command.chunkIndex, 0), queue.length - 1) : found);
      sendResponse(true);
      return false;
    }

    case 'OFF_SET_RATE':
      settings = { ...settings, rate: command.rate };
      if (engine === 'kokoro') {
        kokoro.setRate(command.rate);
      } else if (status === 'playing') {
        // A live utterance ignores rate changes — restart the current sentence.
        playCurrent();
      }
      sendResponse(true);
      return false;

    case 'OFF_LIST_VOICES':
      void allVoices().then((voices) => {
        emit({ type: 'OFF_VOICES', voices });
        sendResponse(voices);
      });
      return true; // responding asynchronously

    default:
      sendResponse(undefined);
      return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const envelope = message as { type?: unknown } | null;
  if (!envelope || typeof envelope.type !== 'string' || !envelope.type.startsWith('OFF_')) {
    return undefined; // UI traffic and our own events — not ours to answer
  }
  try {
    return handle(message as OffscreenCommand, sendResponse);
  } catch (err: unknown) {
    const text = err instanceof Error ? err.message : 'Playback failed';
    status = 'error';
    emit({ type: 'OFF_STATUS', status: 'error', error: text });
    sendResponse(undefined);
    return false;
  }
});
