# Narrate for Zotero

A companion Zotero 7 plugin: select text in Zotero's own PDF/EPUB/snapshot
reader and hear it read aloud.

## Why this is a separate plugin, not part of the Chrome extension

The main Narrate extension (`../src`) is a Chrome extension — it can only
ever see web pages and tabs inside Chrome. Zotero is a separate native
desktop application with its own reader, entirely outside the browser, so
the Chrome extension has no way to reach into it (no content script, no
`chrome.*` API, nothing to inject into).

Zotero solves this itself: Zotero 7 plugins are "bootstrapped extensions"
that run inside Zotero's own Firefox-derived JavaScript runtime, with full
access to standard Web APIs — including `speechSynthesis` and `<audio>` —
inside Zotero's own reader document. That's what this plugin uses. **No
macOS Accessibility or Screen-Recording permission is involved anywhere** —
this is not OS-level automation, it's just Zotero's own plugin API, the same
trust tier as installing any other Zotero plugin from a `.xpi` file.

## What it does (v1 scope)

- Adds a small control row (▶ Narrate, ⏹ Stop, a speed dropdown) to the
  popup that already appears when you select text in the reader.
- "Narrate" reads the current selection aloud using your OS's system voices,
  via the Web Speech API (`speechSynthesis`) — the same free-forever engine
  tier the Chrome extension calls "System voices."
- Changing the speed dropdown while something is playing restarts the
  current selection at the new rate (the Web Speech API can't change the
  rate of an utterance already in progress).

## Limitations (v1)

- **Selection-only.** There's no "read the whole document" button yet.
  Zotero has privacy/security restrictions around raw full-document text
  extraction from the reader, and there's no single documented API for it
  (see "v2 ideas" below) — so for now you select the text you want read,
  same as highlighting on a web page.
- **System voices only.** No neural/Kokoro voice in this plugin yet, even
  though the Chrome extension already ships Kokoro-82M via `kokoro-js`. See
  v2 ideas.
- **No persistence.** The speed setting resets to 1× each time Zotero
  restarts (it's an in-memory default, not saved to Zotero's prefs).
- Only tested for syntax/shape, not run inside an actual Zotero install —
  see "What's verified" below.

## Install (for testing)

Zotero 7 loads plugins from a `.xpi` file, which is just a zip of this
folder's *contents* (not the folder itself — the zip's root must contain
`manifest.json` directly, not `zotero-plugin/manifest.json`).

```bash
cd zotero-plugin
zip -r ../narrate-zotero.xpi manifest.json bootstrap.js narrate.js
```

Then in Zotero:

1. **Tools → Plugins**
2. Click the gear icon (⚙) in the top right of the Plugins window
3. **Install Plugin From File…**
4. Select `narrate-zotero.xpi`
5. Restart Zotero if prompted

To try it: open any PDF in Zotero's reader, select some text, and look for
the Narrate row in the selection popup.

## Files

- `manifest.json` — Zotero 7 plugin manifest (WebExtension-style,
  `applications.zotero` block gates it to Zotero ≥ 7.0).
- `bootstrap.js` — the standard Zotero bootstrap lifecycle
  (`install`/`startup`/`shutdown`/`uninstall`/`onMainWindowLoad`/
  `onMainWindowUnload`). Loads `narrate.js` and wires it up.
- `narrate.js` — the actual feature: registers a handler on Zotero's reader
  `renderTextSelectionPopup` event and builds the Narrate/Stop/speed UI.

No build step, no `package.json`, no TypeScript — Zotero loads `bootstrap.js`
directly, and a plugin this size is normally hand-written JS like the
official [make-it-red](https://github.com/zotero/make-it-red) sample.

## What's verified vs. assumed

Verified directly against Zotero's own source and official docs/samples
(not guessed):

- The bootstrap lifecycle function signatures and the fact that `Zotero`,
  `Services`, and reason constants (`APP_STARTUP`, `APP_SHUTDOWN`,
  `ADDON_DISABLE`, etc.) are injected as bare globals into the plugin's
  sandbox — confirmed by reading `_loadScope`/`_callMethod` in Zotero's own
  `chrome/content/zotero/xpcom/plugins.js`.
- `manifest.json` shape (`manifest_version: 2`, `applications.zotero` with
  `id`/`strict_min_version`/`strict_max_version`) — matches the official
  `zotero/make-it-red` sample's Zotero-7 (`src-2.0`) manifest.
- `Zotero.Reader.registerEventListener(type, handler, pluginID)` and
  `Zotero.Reader.unregisterEventListener(type, handler)`, the
  `'renderTextSelectionPopup'` event, and its handler shape
  `{ reader, doc, params, append }` — confirmed from the JSDoc block and
  worked example directly above `registerEventListener`'s definition in
  Zotero's `chrome/content/zotero/xpcom/reader.js`. That worked example
  itself reads the selected text as `params.annotation.text`, which is what
  this plugin uses. This is also consistent with
  [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)'s
  `getSelectedText()` helper, which reads the same `.annotation.text` shape.
- `speechSynthesis` / `SpeechSynthesisUtterance` availability on the reader
  document's `window` (`doc.defaultView`) — per the prior research behind
  this task: Zotero 7 plugins run with full standard Web API access, no OS
  permission needed.

Assumptions / not independently verified in this environment (can't run
Zotero here):

- That the reader popup's container actually gives enough width/layout room
  for a `<select>` without visual overflow — worth a quick look once loaded
  in a real Zotero build.
- `strict_max_version: "7.*"` — a wildcard pattern used by other real Zotero
  plugins (e.g. `Zutilo` uses `"10.*"`), chosen so this doesn't need a manifest
  bump for every Zotero 7.x point release; not from an official spec page.
- The plugin `id`, `narrate@narrate-app.dev`, is a placeholder per the task
  brief — swap it for a real domain before any real distribution, and note
  IDs can't be changed after users have installed a version.

## v2 ideas (not built here)

- **Whole-document read-aloud.** No single documented API for this exists
  today (a plugin author on the Zotero forums has noted deliberate
  privacy/security restrictions on raw full-document text access from
  plugins) — would need more research into whatever's current when this is
  picked up.
- **Kokoro-82M as an alternate voice.** The Chrome extension already ships
  Kokoro-82M via `kokoro-js` (WASM/WebGPU, on-device). Embedding that same
  WASM model directly in this plugin is out of scope for now (real binary
  size/perf cost); a lighter path worth investigating is pointing at a local
  Kokoro-FastAPI server, the same approach used by some existing "Zotero TTS"
  community plugins.
- **Play-along / synced highlighting** while reading, in the spirit of
  [listen2papers](https://github.com/ysqander/listen2papers-zotero)'s UX —
  nice-to-have, not attempted here to keep v1 small.
- Persist the speed setting via `Zotero.Prefs` across restarts.
- A toolbar/menu entry to narrate an existing annotation's text, not just a
  fresh selection.

## Prior art consulted

- [ZoTTS](https://github.com/ImperialSquid/zotero-zotts) — selection/
  annotation → system voices via the Web Speech API. This plugin's
  selection-popup approach follows the same shape (register on
  `renderTextSelectionPopup`, add buttons via `append`), written by hand
  here instead of depending on `zotero-plugin-toolkit`/a build pipeline, per
  this task's "no bundler for a plugin this size" scope.
