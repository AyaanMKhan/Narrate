/** Playback speeds offered in the UI. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export type Speed = (typeof SPEEDS)[number];

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

/** Chrome kills utterances longer than ~32k chars; keep chunks well under. */
export const MAX_CHUNK_CHARS = 240;

export const OFFSCREEN_PATH = 'offscreen.html';
export const VIEWER_PATH = 'viewer.html';

/* PDF.js runs fully bundled — MV3 forbids remote code, so the worker and its
   font/CMap data ship inside the extension. */
export const PDF_WORKER_PATH = 'pdf/pdf.worker.min.mjs';
export const PDF_CMAP_PATH = 'pdf/cmaps/';
export const PDF_STANDARD_FONTS_PATH = 'pdf/standard_fonts/';
export const PDF_WASM_PATH = 'pdf/wasm/';

/** Kokoro-82M — Apache-2.0, runs fully on-device. No API key, no cost. */
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart', lang: 'en-US' },
  { id: 'af_bella', name: 'Bella', lang: 'en-US' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US' },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-US' },
  { id: 'am_michael', name: 'Michael', lang: 'en-US' },
  { id: 'am_adam', name: 'Adam', lang: 'en-US' },
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-GB' },
  { id: 'bm_george', name: 'George', lang: 'en-GB' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB' },
] as const;

export const BRAND = {
  name: 'Narrate',
  tagline: 'Highlight anything. Hear it instantly.',
};
