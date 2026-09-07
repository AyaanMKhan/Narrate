/**
 * Narrate background service worker — the single source of truth for
 * PlaybackState. Owns the offscreen document, the context menus and the
 * keyboard commands; every UI surface talks to it and reads state back.
 */
import { chunkText } from '@/shared/chunk';
import { KOKORO_VOICES, MAX_RATE, MIN_RATE, OFFSCREEN_PATH, VIEWER_PATH } from '@/shared/constants';
import { loadSettings, saveSettings } from '@/shared/storage';
import {
  DEFAULT_SETTINGS,
  INITIAL_STATE,
  type BroadcastMessage,
  type Chunk,
  type OffscreenCommand,
  type OffscreenEvent,
  type PlaybackState,
  type Settings,
  type UiMessage,
  type VoiceOption,
} from '@/shared/types';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let state: PlaybackState = { ...INITIAL_STATE };
let settings: Settings = { ...DEFAULT_SETTINGS };
let chunks: Chunk[] = [];
/** Chunk.index of the first chunk the offscreen queue currently holds. */
let queueOffset = 0;
let voiceCache: VoiceOption[] = [];

const settingsReady: Promise<void> = loadSettings()
  .then((loaded) => {
    settings = loaded;
    state = { ...state, engine: loaded.engine, rate: loaded.rate, voiceId: voiceIdFor(loaded) };
  })
  .catch(() => {
    /* storage unavailable — defaults are already in place */
  });

function voiceIdFor(s: Settings): string | null {
  return s.engine === 'kokoro' ? s.kokoroVoiceId : s.systemVoiceId;
}

function reason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === 'string' && err ? err : 'Something went wrong';
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/* ------------------------------------------------------------------ */
/* Broadcast                                                           */
/* ------------------------------------------------------------------ */

function quiet(promise: Promise<unknown> | undefined): void {
  try {
    void promise?.catch?.(() => {});
  } catch {
    /* "no receiving end" / context invalidated — always safe to ignore */
  }
}

function updateBadge(): void {
  const text = state.status === 'playing' ? '▶' : state.status === 'paused' ? '⏸' : '';
  quiet(chrome.action.setBadgeText({ text }));
  quiet(chrome.action.setBadgeBackgroundColor({ color: '#6d5efc' }));
}

function broadcastState(): void {
  const message: BroadcastMessage = { type: 'STATE', state };
  try {
    quiet(chrome.runtime.sendMessage(message));
  } catch {
    /* no popup open */
  }
  if (state.tabId !== null) {
    try {
      quiet(chrome.tabs.sendMessage(state.tabId, message));
    } catch {
      /* tab has no content script (chrome:// pages, PDFs, …) */
    }
  }
  updateBadge();
}

function broadcastSettings(): void {
  const message: BroadcastMessage = { type: 'SETTINGS', settings };
  try {
    quiet(chrome.runtime.sendMessage(message));
  } catch {
    /* no listener */
  }
  if (state.tabId !== null) {
    try {
      quiet(chrome.tabs.sendMessage(state.tabId, message));
    } catch {
      /* no content script */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Offscreen document                                                  */
/* ------------------------------------------------------------------ */

let creating: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  // Two concurrent callers would otherwise both try to create the document.
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK' as chrome.offscreen.Reason],
      justification: 'Play synthesized speech',
    })
    .catch((err: unknown) => {
      // Lost the race with another creator — that's the outcome we wanted anyway.
      if (!/single offscreen document/i.test(reason(err))) throw err;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function toOffscreen(command: OffscreenCommand): Promise<unknown> {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage(command);
  } catch {
    return undefined; // offscreen document torn down mid-flight
  }
}

/* ------------------------------------------------------------------ */
/* Playback control                                                    */
/* ------------------------------------------------------------------ */

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

async function startSpeak(text: string, title: string | undefined, tabId: number | null): Promise<PlaybackState> {
  const next = chunkText(text);
  if (!next.length) return state;

  chunks = next;
  queueOffset = 0;
  state = {
    ...INITIAL_STATE,
    status: 'loading',
    engine: settings.engine,
    text,
    title: title?.trim() || preview(text),
    chunkCount: next.length,
    rate: settings.rate,
    voiceId: voiceIdFor(settings),
    tabId,
  };
  broadcastState();
  await toOffscreen({ type: 'OFF_SPEAK', chunks: next, settings });
  return state;
}

async function stopPlayback(): Promise<PlaybackState> {
  if (await hasOffscreen()) await toOffscreen({ type: 'OFF_STOP' });
  chunks = [];
  queueOffset = 0;
  state = { ...state, status: 'idle', chunkIndex: 0, progress: 0, error: null, modelProgress: null };
  broadcastState();
  return state;
}

/** Re-issue the queue from the current chunk so a new voice/engine/rate applies now. */
async function restartAtCurrent(): Promise<void> {
  if (state.status !== 'playing' || !chunks.length) return;
  const from = chunks.findIndex((c) => c.index === state.chunkIndex);
  const rest = chunks.slice(from === -1 ? 0 : from);
  queueOffset = rest[0]?.index ?? 0;
  state = { ...state, engine: settings.engine, rate: settings.rate, voiceId: voiceIdFor(settings) };
  await toOffscreen({ type: 'OFF_SPEAK', chunks: rest, settings });
  broadcastState();
}

/* ------------------------------------------------------------------ */
/* PDF viewer                                                          */
/* ------------------------------------------------------------------ */

/* Chrome renders PDFs through PDFium inside an <embed>, so no content script
   can reach their text — we route them into Narrate's own reader instead. */

const PDF_URL = /\.pdf(\?|#|$)/i;
const VIEWER_URL = chrome.runtime.getURL(VIEWER_PATH);

function isPdfUrl(url: string | undefined | null): url is string {
  if (!url || !/^(https?|file):/i.test(url)) return false;
  try {
    // Match on the path only — a query like "?q=report.pdf" is not a PDF,
    // and hijacking that navigation would be a real bug.
    return PDF_URL.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isViewerUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith(VIEWER_URL);
}

function viewerUrlFor(url?: string): string {
  return url ? `${VIEWER_URL}?file=${encodeURIComponent(url)}` : VIEWER_URL;
}

/* A Drive preview page fetches its own PDF bytes (see DrivePdfButton — it
   needs the page's own cookies, which a background fetch can never have) and
   hands them here. We hold them just long enough for the viewer tab we open
   to collect them once; nothing is ever written to disk. */
const DRIVE_HANDOFF_TTL_MS = 60_000;
const pendingDrivePdfs = new Map<string, { name: string; buffer: ArrayBuffer }>();

function driveViewerUrlFor(id: string): string {
  return `${VIEWER_URL}?drive=${id}`;
}

/** Open the reader, reusing a tab already showing the same document. */
async function openViewer(url?: string): Promise<boolean> {
  const target = viewerUrlFor(url);
  try {
    const tabs = await chrome.tabs.query({ url: `${VIEWER_URL}*` });
    const open = tabs.find((tab) => tab.url === target || tab.pendingUrl === target);
    if (open?.id !== undefined) {
      await chrome.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined) {
        await chrome.windows.update(open.windowId, { focused: true });
      }
      return true;
    }
  } catch {
    /* query unavailable (no tab URLs) — just open a fresh tab */
  }
  try {
    await chrome.tabs.create({ url: target });
    return true;
  } catch {
    return false;
  }
}

/* A redirect makes Chrome fire onUpdated again; without this the same tab/url
   pair could bounce between Chrome's viewer and ours. Entries are short-lived
   so a deliberate revisit still works. */
const REDIRECT_GUARD_MS = 5_000;
const redirected = new Set<string>();

function markRedirected(key: string): void {
  redirected.add(key);
  setTimeout(() => redirected.delete(key), REDIRECT_GUARD_MS);
}

/* ------------------------------------------------------------------ */
/* Tab helpers                                                         */
/* ------------------------------------------------------------------ */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

/** Injected into the page — must be self-contained. */
function extractReadableText(): string {
  const node: HTMLElement =
    document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  return (node.innerText || node.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function speakActivePage(): Promise<PlaybackState> {
  const tab = await activeTab();
  if (!tab?.id) return state;
  // Scraping a PDF tab always comes back empty — hand it to the reader instead.
  if (isPdfUrl(tab.url)) {
    await openViewer(tab.url);
    return state;
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractReadableText,
    });
    const text = typeof result?.result === 'string' ? result.result : '';
    if (!text) return state;
    return await startSpeak(text, tab.title ?? undefined, tab.id);
  } catch (err: unknown) {
    state = { ...state, status: 'error', error: reason(err) };
    broadcastState();
    return state;
  }
}

async function selectionInTab(tabId: number): Promise<string> {
  try {
    const response: unknown = await chrome.tabs.sendMessage(tabId, { type: 'GET_SELECTION' });
    if (typeof response === 'string') return response.trim();
    if (response && typeof response === 'object' && 'text' in response) {
      const text = (response as { text?: unknown }).text;
      return typeof text === 'string' ? text.trim() : '';
    }
  } catch {
    /* no content script on this page */
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

function kokoroVoices(): VoiceOption[] {
  return KOKORO_VOICES.map((v) => ({ id: v.id, name: v.name, lang: v.lang, engine: 'kokoro' as const }));
}

async function listVoices(): Promise<VoiceOption[]> {
  const response = await toOffscreen({ type: 'OFF_LIST_VOICES' });
  if (Array.isArray(response) && response.length) voiceCache = response as VoiceOption[];
  return voiceCache.length ? voiceCache : kokoroVoices();
}

/* ------------------------------------------------------------------ */
/* UI message routing                                                  */
/* ------------------------------------------------------------------ */

async function handleUi(message: UiMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await settingsReady;

  switch (message.type) {
    case 'SPEAK': {
      const tabId = sender.tab?.id ?? (await activeTab())?.id ?? null;
      return startSpeak(message.text, message.title, tabId);
    }

    case 'PAUSE':
      await toOffscreen({ type: 'OFF_PAUSE' });
      return state;

    case 'RESUME':
      await toOffscreen({ type: 'OFF_RESUME' });
      return state;

    case 'STOP':
      return stopPlayback();

    case 'SKIP': {
      if (!state.chunkCount) return state;
      const target = clamp(state.chunkIndex + message.delta, 0, state.chunkCount - 1);
      // A restart may have trimmed the offscreen queue — reload it before seeking back.
      if (target < queueOffset) {
        queueOffset = 0;
        await toOffscreen({ type: 'OFF_SPEAK', chunks, settings });
      }
      await toOffscreen({ type: 'OFF_SEEK', chunkIndex: target });
      return state;
    }

    case 'SET_RATE': {
      const rate = clamp(message.rate, MIN_RATE, MAX_RATE);
      settings = await saveSettings({ rate });
      state = { ...state, rate };
      broadcastSettings();
      await toOffscreen({ type: 'OFF_SET_RATE', rate }); // live, no restart needed
      broadcastState();
      return state;
    }

    case 'SET_VOICE': {
      const patch: Partial<Settings> =
        message.engine === 'kokoro'
          ? { engine: 'kokoro', kokoroVoiceId: message.voiceId }
          : { engine: 'system', systemVoiceId: message.voiceId };
      settings = await saveSettings(patch);
      broadcastSettings();
      await restartAtCurrent();
      state = { ...state, engine: settings.engine, voiceId: voiceIdFor(settings) };
      broadcastState();
      return state;
    }

    case 'SET_ENGINE': {
      settings = await saveSettings({ engine: message.engine });
      broadcastSettings();
      await restartAtCurrent();
      state = { ...state, engine: settings.engine, voiceId: voiceIdFor(settings) };
      broadcastState();
      return state;
    }

    case 'GET_STATE':
      return state;

    case 'GET_VOICES':
      return listVoices();

    case 'GET_SETTINGS':
      return settings;

    case 'SAVE_SETTINGS': {
      settings = await saveSettings(message.settings);
      state = { ...state, engine: settings.engine, rate: settings.rate, voiceId: voiceIdFor(settings) };
      broadcastSettings();
      if (message.settings.rate !== undefined) {
        await toOffscreen({ type: 'OFF_SET_RATE', rate: settings.rate });
      }
      if (message.settings.engine !== undefined || message.settings.kokoroVoiceId !== undefined ||
          message.settings.systemVoiceId !== undefined) {
        await restartAtCurrent();
      }
      broadcastState();
      return settings;
    }

    case 'SPEAK_PAGE':
      return speakActivePage();

    case 'OPEN_PDF_VIEWER':
      return openViewer(message.url);

    case 'GET_FILE_ACCESS':
      try {
        return await chrome.extension.isAllowedFileSchemeAccess();
      } catch {
        return false;
      }

    case 'OPEN_DRIVE_PDF': {
      const id = crypto.randomUUID();
      pendingDrivePdfs.set(id, { name: message.name, buffer: message.buffer });
      setTimeout(() => pendingDrivePdfs.delete(id), DRIVE_HANDOFF_TTL_MS);
      try {
        await chrome.tabs.create({ url: driveViewerUrlFor(id) });
        return true;
      } catch {
        pendingDrivePdfs.delete(id);
        return false;
      }
    }

    case 'GET_DRIVE_PDF': {
      // One-shot: the viewer is the only consumer, and only ever asks once.
      const entry = pendingDrivePdfs.get(message.id) ?? null;
      pendingDrivePdfs.delete(message.id);
      return entry;
    }

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Offscreen event handling                                            */
/* ------------------------------------------------------------------ */

const OFFSCREEN_EVENTS = new Set([
  'OFF_STATUS',
  'OFF_CHUNK',
  'OFF_DONE',
  'OFF_MODEL_PROGRESS',
  'OFF_VOICES',
]);

function handleOffscreenEvent(event: OffscreenEvent): void {
  switch (event.type) {
    case 'OFF_STATUS':
      state = { ...state, status: event.status, error: event.error ?? null };
      if (event.status === 'playing') state = { ...state, modelProgress: null };
      break;

    case 'OFF_CHUNK':
      state = {
        ...state,
        chunkIndex: event.chunkIndex,
        progress: state.chunkCount ? clamp(event.chunkIndex / state.chunkCount, 0, 1) : 0,
      };
      break;

    case 'OFF_DONE':
      chunks = [];
      state = { ...state, status: 'idle', progress: 1, modelProgress: null };
      break;

    case 'OFF_MODEL_PROGRESS':
      state = { ...state, modelProgress: clamp(event.progress, 0, 1) };
      break;

    case 'OFF_VOICES':
      voiceCache = event.voices;
      return; // no state change worth broadcasting
  }
  broadcastState();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const envelope = message as { type?: unknown } | null;
  if (!envelope || typeof envelope.type !== 'string') return undefined;

  if (OFFSCREEN_EVENTS.has(envelope.type)) {
    handleOffscreenEvent(message as OffscreenEvent);
    sendResponse(true);
    return undefined;
  }
  if (envelope.type.startsWith('OFF_')) return undefined; // our own commands, bound elsewhere

  void handleUi(message as UiMessage, sender)
    .then((result) => sendResponse(result))
    .catch((err: unknown) => sendResponse({ error: reason(err) }));
  return true; // responding asynchronously
});

/* ------------------------------------------------------------------ */
/* Context menus                                                       */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'narrate-selection',
      title: 'Narrate "%s"',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'narrate-page',
      title: 'Narrate this page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'narrate-pdf-link',
      title: 'Open in Narrate PDF reader',
      contexts: ['link'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'narrate-selection') {
    const text = (info.selectionText ?? '').trim();
    if (text) void startSpeak(text, tab?.title ?? undefined, tab?.id ?? null);
    return;
  }
  if (info.menuItemId === 'narrate-page') {
    void speakActivePage();
    return;
  }
  // Shown on every link; only a PDF target is ours to handle.
  if (info.menuItemId === 'narrate-pdf-link' && isPdfUrl(info.linkUrl)) {
    void openViewer(info.linkUrl);
  }
});

/* ------------------------------------------------------------------ */
/* Keyboard commands                                                   */
/* ------------------------------------------------------------------ */

async function narrateSelection(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id) return;
  const text = await selectionInTab(tab.id);
  if (text) await startSpeak(text, tab.title ?? undefined, tab.id);
}

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    await settingsReady;
    if (command === 'narrate-selection') {
      await narrateSelection();
      return;
    }
    if (command !== 'narrate-toggle') return;

    if (state.status === 'playing') {
      await toOffscreen({ type: 'OFF_PAUSE' });
    } else if (state.status === 'paused') {
      await toOffscreen({ type: 'OFF_RESUME' });
    } else if (state.status === 'loading') {
      await stopPlayback();
    } else {
      const tab = await activeTab();
      const text = tab?.id ? await selectionInTab(tab.id) : '';
      if (text && tab?.id) await startSpeak(text, tab.title ?? undefined, tab.id);
      else await speakActivePage();
    }
  })();
});

/* ------------------------------------------------------------------ */
/* Tab lifecycle — playback dies with the page that owns it            */
/* ------------------------------------------------------------------ */

chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.tabId === tabId && state.status !== 'idle') void stopPlayback();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (state.tabId !== tabId || state.status === 'idle') return;
  // A committed navigation replaces the text we were reading.
  if (changeInfo.status === 'loading' && changeInfo.url) void stopPlayback();
});

/* ------------------------------------------------------------------ */
/* Auto-open PDFs in Narrate's reader (opt-in)                         */
/* ------------------------------------------------------------------ */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  const url = changeInfo.url ?? tab.url;
  if (!isPdfUrl(url) || isViewerUrl(url)) return;

  const key = `${tabId}|${url}`;
  if (redirected.has(key)) return;

  void (async () => {
    await settingsReady; // the worker may have just woken up
    if (!settings.openPdfsInNarrate || redirected.has(key)) return;
    markRedirected(key);
    quiet(chrome.tabs.update(tabId, { url: viewerUrlFor(url) }));
  })();
});
