import type { PlaybackState, Settings, UiMessage, VoiceOption } from './types';

/** Fire-and-forget send that tolerates "no receiving end" during startup. */
export function sendQuiet(message: unknown): void {
  try {
    void chrome.runtime.sendMessage(message)?.catch?.(() => {});
  } catch {
    /* extension context invalidated on reload — safe to ignore */
  }
}

export async function send<T = unknown>(message: UiMessage): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return undefined;
  }
}

export const api = {
  speak: (text: string, title?: string) => send({ type: 'SPEAK', text, title }),
  pause: () => send({ type: 'PAUSE' }),
  resume: () => send({ type: 'RESUME' }),
  stop: () => send({ type: 'STOP' }),
  skip: (delta: number) => send({ type: 'SKIP', delta }),
  setRate: (rate: number) => send({ type: 'SET_RATE', rate }),
  setEngine: (engine: Settings['engine']) => send({ type: 'SET_ENGINE', engine }),
  setVoice: (voiceId: string, engine: Settings['engine']) =>
    send({ type: 'SET_VOICE', voiceId, engine }),
  getState: () => send<PlaybackState>({ type: 'GET_STATE' }),
  getVoices: () => send<VoiceOption[]>({ type: 'GET_VOICES' }),
  getSettings: () => send<Settings>({ type: 'GET_SETTINGS' }),
  saveSettings: (settings: Partial<Settings>) =>
    send<Settings>({ type: 'SAVE_SETTINGS', settings }),
  speakPage: () => send({ type: 'SPEAK_PAGE' }),
  openPdfViewer: (url?: string) => send({ type: 'OPEN_PDF_VIEWER', url }),
  getFileAccess: () => send<boolean>({ type: 'GET_FILE_ACCESS' }),
};
