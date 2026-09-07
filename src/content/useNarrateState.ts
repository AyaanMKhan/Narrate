import { useEffect, useState } from 'react';
import { api } from '@/shared/messaging';
import {
  DEFAULT_SETTINGS,
  INITIAL_STATE,
  type BroadcastMessage,
  type PlaybackState,
  type Settings,
} from '@/shared/types';

export interface NarrateStateSnapshot {
  state: PlaybackState;
  settings: Settings;
}

/** Narrow an untrusted runtime message down to our broadcast union. */
function asBroadcast(message: unknown): BroadcastMessage | null {
  if (typeof message !== 'object' || message === null) return null;
  const type = (message as { type?: unknown }).type;
  if (type === 'STATE' || type === 'SETTINGS' || type === 'SHOW_BUBBLE' || type === 'PING') {
    return message as BroadcastMessage;
  }
  return null;
}

/**
 * Subscribes to background STATE / SETTINGS broadcasts and seeds itself from
 * the service worker on mount. Every chrome.* touch is failure-tolerant so a
 * reloaded extension context can never throw into the host page.
 */
export function useNarrateState(): NarrateStateSnapshot {
  const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let alive = true;

    const listener = (message: unknown): void => {
      const broadcast = asBroadcast(message);
      if (!broadcast || !alive) return;
      if (broadcast.type === 'STATE') setState(broadcast.state);
      else if (broadcast.type === 'SETTINGS') setSettings(broadcast.settings);
    };

    try {
      chrome.runtime.onMessage.addListener(listener);
    } catch {
      /* extension context invalidated — render with defaults */
    }

    void (async () => {
      const [nextState, nextSettings] = await Promise.all([api.getState(), api.getSettings()]);
      if (!alive) return;
      if (nextState) setState(nextState);
      if (nextSettings) setSettings(nextSettings);
    })();

    return () => {
      alive = false;
      try {
        chrome.runtime.onMessage.removeListener(listener);
      } catch {
        /* nothing to clean up if the context is already gone */
      }
    };
  }, []);

  return { state, settings };
}
