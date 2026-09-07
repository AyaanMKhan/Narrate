# Narrate — free text-to-speech for Chrome

Highlight any text on any page and hear it read aloud. Built with React + TypeScript on Manifest V3.

**Zero cost, forever.** No API keys, no accounts, no servers, no usage limits. Both speech engines run entirely on your own machine.

---

## Features

- **Highlight to narrate** — select text anywhere and a floating bubble offers to read it.
- **Speeds from 0.5× to 3×** — `0.5 · 0.75 · 1 · 1.25 · 1.5 · 1.75 · 2 · 2.5 · 3`, changeable mid-playback.
- **Two free engines** — instant system voices, or a neural AI voice that runs on-device.
- **Read the whole page** — one click in the popup extracts the article text and reads it.
- **Sentence-level transport** — skip forward/back a sentence, pause, resume, stop.
- **Keyboard shortcuts** — `Alt+Shift+S` narrate selection, `Alt+Shift+P` play/pause.
- **Light and dark** — follows your system theme, or force either.
- **Reads PDFs too** — including files on your own computer, via Narrate's built-in reader.
- **Private by construction** — no network calls except the one-time optional model download.

## The speech engines (both free)

| | System voices | Neural (Kokoro) |
|---|---|---|
| Source | Your OS / Chrome's built-in `speechSynthesis` | [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), Apache-2.0 |
| Runs on | Your device | Your device (WebGPU, WASM fallback) |
| Download | None | ~80 MB, once, then cached offline |
| Cost | $0 | $0 |
| API key | None | None |

Kokoro is loaded through [`kokoro-js`](https://github.com/hexgrad/kokoro) / Transformers.js and executes inside the extension's offscreen document. Your text is never transmitted anywhere — there is no backend in this project.

## PDFs

Chrome's built-in PDF viewer renders through PDFium inside an `<embed>`, and **does not expose its text to extensions** — `window.getSelection()` in that tab returns nothing. No extension can read those PDFs, so Narrate ships its own reader built on [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0, bundled, no network).

Three ways in:

1. **Popup → "Open a PDF…"** — then drag a file in or pick one. Works immediately, needs no extra permission, because the file is read through the browser's file picker rather than a `file://` URL.
2. **Right-click a PDF link → "Open in Narrate PDF reader"**.
3. **Automatic** — enable *Open PDFs in Narrate* in the popup and any PDF you navigate to opens in the reader.

### Reading PDFs stored on your computer

Options 1 and 2 work without setup. For option 3 to work on **local** files (`file:///…`), Chrome requires you to grant file access explicitly — this is a browser rule no extension can bypass:

1. Go to `chrome://extensions`
2. Click **Details** on Narrate
3. Enable **Allow access to file URLs**

The popup detects whether this is granted and shows a reminder if it isn't. Your PDF is parsed locally by PDF.js; nothing is uploaded.

## Install (unpacked)

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. Pin Narrate to the toolbar

To produce a Web Store upload: `npm run zip` → `narrate.zip`.

## Development

```bash
npm run dev        # rebuild on change (reload the extension in chrome://extensions to pick it up)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + full production build into dist/
```

## Architecture

```
src/
  shared/       types.ts (message contract), constants.ts, storage.ts,
                chunk.ts (sentence splitting), messaging.ts
  background/   service-worker.ts   — state owner, context menus, commands, routing
  offscreen/    offscreen.ts        — playback queue; MV3 service workers cannot play audio
                system-engine.ts    — Web Speech API wrapper (+ Chrome's 15s-stall workaround)
                kokoro-engine.ts    — lazily loaded on-device neural voice
  content/      content.tsx         — Shadow DOM mount, selection tracking
                SelectionBubble.tsx — the highlight-to-narrate pill
                MiniPlayer.tsx      — floating transport controls
  popup/        Popup.tsx + components/ — toolbar panel and settings
  viewer/       Viewer.tsx, pdf.ts  — PDF.js reader (Chrome's own viewer hides its text)
  ui/           tokens.css          — the single source of colour, radius and shadow
```

**Why an offscreen document?** MV3 service workers have no DOM and cannot play audio, and they're killed when idle. The offscreen document gives us a persistent DOM context for `speechSynthesis` and `<audio>` playback; the service worker stays the single owner of playback state and broadcasts it to every UI surface.

**Why Shadow DOM in the content script?** Host pages have hostile CSS. The in-page UI mounts into a shadow root with its own injected stylesheet, so nothing leaks in either direction.

## Permissions, and why each is needed

| Permission | Reason |
|---|---|
| `storage` | Persist your voice, speed and preferences |
| `contextMenus` | The right-click "Narrate" entry |
| `offscreen` | Audio playback (impossible in an MV3 service worker) |
| `activeTab`, `scripting` | Extract article text for "Narrate this page" |
| `<all_urls>` | Show the highlight bubble on any site you use it on |

*"Allow access to file URLs" is a separate, optional toggle you control in `chrome://extensions` — it is only needed to auto-open PDFs stored on your computer.*

## License

MIT.
