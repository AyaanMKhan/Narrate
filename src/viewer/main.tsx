import React from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '@/shared/messaging';
import type { Settings } from '@/shared/types';
import Viewer from './Viewer';
import './viewer.css';

/** tokens.css keys its dark palette off [data-theme] — mirror the preference. */
function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

void api.getSettings().then((settings) => {
  if (settings) applyTheme(settings.theme);
});

try {
  chrome.runtime.onMessage.addListener((message: unknown): undefined => {
    if (typeof message !== 'object' || message === null) return undefined;
    const envelope = message as { type?: unknown; settings?: Settings };
    if (envelope.type === 'SETTINGS' && envelope.settings) applyTheme(envelope.settings.theme);
    return undefined;
  });
} catch {
  /* extension context invalidated — the default theme still renders fine */
}

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <Viewer />
    </React.StrictMode>,
  );
}
