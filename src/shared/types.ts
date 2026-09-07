/**
 * Narrate — shared contract between the content script, popup,
 * background service worker and the offscreen audio document.
 * Every module codes against this file; nothing here imports anything else.
 */

export type EngineId = 'system' | 'kokoro';

export type PlaybackStatus =
  | 'idle'
  | 'loading'   // engine warming up / model downloading
  | 'playing'
  | 'paused'
  | 'error';

/** A single spoken unit — we chunk by sentence so seeking + highlighting work. */
export interface Chunk {
  index: number;
  text: string;
  /** Character offset of this chunk inside the original full text. */
  start: number;
  end: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  engine: EngineId;
  /** Full text currently loaded (may be empty when idle). */
  text: string;
  /** Short label for the UI, e.g. the page title or first few words. */
  title: string;
  chunkIndex: number;
  chunkCount: number;
  /** 0..1 across the whole utterance. */
  progress: number;
  rate: number;
  voiceId: string | null;
  /** Set only when status === 'error'. */
  error: string | null;
  /** 0..1 while a neural model is downloading. */
  modelProgress: number | null;
  /** Tab that owns the current playback, if any. */
  tabId: number | null;
}

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  engine: EngineId;
  /** True for OS voices that synthesize without a network round-trip. */
  localService?: boolean;
}

export interface Settings {
  engine: EngineId;
  /** Voice id for the system engine (SpeechSynthesisVoice.voiceURI). */
  systemVoiceId: string | null;
  /** Voice id for the Kokoro engine, e.g. "af_heart". */
  kokoroVoiceId: string;
  rate: number;
  pitch: number;
  volume: number;
  /** Show the floating bubble automatically when text is selected. */
  showBubbleOnSelect: boolean;
  /** Tint the sentence currently being spoken on the page. */
  highlightSpoken: boolean;
  /** Open PDFs in Narrate's own reader instead of Chrome's viewer. */
  openPdfsInNarrate: boolean;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'system',
  systemVoiceId: null,
  kokoroVoiceId: 'af_heart',
  rate: 1,
  pitch: 1,
  volume: 1,
  showBubbleOnSelect: true,
  highlightSpoken: true,
  openPdfsInNarrate: false,
  theme: 'system',
};

export const INITIAL_STATE: PlaybackState = {
  status: 'idle',
  engine: 'system',
  text: '',
  title: '',
  chunkIndex: 0,
  chunkCount: 0,
  progress: 0,
  rate: 1,
  voiceId: null,
  error: null,
  modelProgress: null,
  tabId: null,
};

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/** UI (content script / popup) -> background service worker. */
export type UiMessage =
  | { type: 'SPEAK'; text: string; title?: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'SKIP'; delta: number }
  | { type: 'SET_RATE'; rate: number }
  | { type: 'SET_VOICE'; voiceId: string; engine: EngineId }
  | { type: 'SET_ENGINE'; engine: EngineId }
  | { type: 'GET_STATE' }
  | { type: 'GET_VOICES' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'SPEAK_PAGE' }
  /** Open Narrate's PDF reader, optionally on a specific document. */
  | { type: 'OPEN_PDF_VIEWER'; url?: string }
  /** Whether the user has granted "Allow access to file URLs". */
  | { type: 'GET_FILE_ACCESS' };

/** Background -> offscreen audio document. */
export type OffscreenCommand =
  | { type: 'OFF_SPEAK'; chunks: Chunk[]; settings: Settings }
  | { type: 'OFF_PAUSE' }
  | { type: 'OFF_RESUME' }
  | { type: 'OFF_STOP' }
  | { type: 'OFF_SEEK'; chunkIndex: number }
  | { type: 'OFF_SET_RATE'; rate: number }
  | { type: 'OFF_LIST_VOICES' };

/** Offscreen -> background. */
export type OffscreenEvent =
  | { type: 'OFF_STATUS'; status: PlaybackStatus; error?: string }
  | { type: 'OFF_CHUNK'; chunkIndex: number }
  | { type: 'OFF_DONE' }
  | { type: 'OFF_MODEL_PROGRESS'; progress: number }
  | { type: 'OFF_VOICES'; voices: VoiceOption[] };

/** Background -> all UI surfaces (broadcast). */
export type BroadcastMessage =
  | { type: 'STATE'; state: PlaybackState }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'SHOW_BUBBLE' }
  | { type: 'PING' };

export type AnyMessage = UiMessage | OffscreenCommand | OffscreenEvent | BroadcastMessage;

/** Envelope every message travels in, so routers can tell surfaces apart. */
export interface Envelope<T = AnyMessage> {
  target: 'background' | 'offscreen' | 'ui';
  message: T;
}
