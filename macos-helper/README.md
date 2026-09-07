# Narrate Helper (macOS)

A standalone macOS menu-bar app that narrates text in **native apps the
Chrome extension can never reach** — Preview.app showing a local PDF,
Zotero's desktop reader, or anything else on your Mac. It is a completely
separate program from the Narrate Chrome extension in this repo; there is
no browser involved and no communication between the two (yet — see
"What v2 could add" below).

## Why this exists

The Narrate Chrome extension only has access to a web page's DOM inside
the browser sandbox. It has no path — none — to text rendered by a
native macOS application like Preview or Zotero. Reading those requires a
real, separate app that you explicitly grant OS-level permission to.

## How it works

1. You click **Narrate Frontmost Window** in the menu-bar icon's menu.
2. The app takes a screenshot of whatever window is currently frontmost
   (`CGWindowListCreateImage`).
3. It runs Apple's Vision framework (`VNRecognizeTextRequest`, `.accurate`
   level) over that screenshot to recognize the text.
4. It speaks the recognized text with `AVSpeechSynthesizer` (a built-in
   macOS system voice).

Because this pipeline only ever looks at *pixels on screen*, it works
identically no matter which app is frontmost. That's a deliberate,
load-bearing design choice — see the next section.

### Why OCR instead of the Accessibility API

The obvious-looking alternative is the macOS Accessibility API (AX) —
`AXUIElementCopyAttributeValue` and friends, gated behind the
Accessibility permission in System Settings. It was evaluated and
rejected as the primary mechanism for this tool:

- PDFKit-rendered text in Preview.app frequently does **not** expose an
  `AXValue` through the AX tree, even when `AXStaticText` nodes exist for
  the content. AX walks find the right elements but come back with no
  text to read.
- Zotero's PDF reader is inconsistent about this too.

Screen Recording + OCR sidesteps this entirely, because it never asks an
app to cooperate with an accessibility tree — it just reads what's
visibly rendered. That makes it reliable and app-agnostic, at the cost of
OCR accuracy and no synced highlighting (see Limitations).

### Why `CGWindowListCreateImage` instead of ScreenCaptureKit

`CGWindowListCreateImage` is deprecated on macOS 14+ in favor of
ScreenCaptureKit, but was chosen for v1 anyway:

- It's synchronous — no `SCStream`/delegate/async-sequence setup needed
  just to grab one frame.
- It works from a plain Swift Package Manager executable with **no**
  Info.plist, no entitlements file, and no `.app` bundle — just the
  Screen Recording permission grant itself.
- ScreenCaptureKit's content-sharing APIs are real machinery that pays
  off once this becomes a properly packaged, signed `.app` — a good
  target for v2.

## Building and running

Requires Xcode command line tools (for `swift`/`swiftc`) on macOS. No
Xcode project or GUI is needed — this is a pure Swift Package Manager
executable.

```sh
cd macos-helper
swift build          # compiles the executable
swift run             # builds (if needed) and launches it
```

`swift build` produces a binary at `.build/debug/NarrateHelper`, which
you can also run directly:

```sh
.build/debug/NarrateHelper
```

The app has no windows or Dock icon — it runs as a menu-bar-only
accessory app (`NSApp.setActivationPolicy(.accessory)`). Look for its
speaker icon in the menu bar. Quit it from its own menu ("Quit Narrate
Helper") or with `kill`/Activity Monitor while developing.

## Permission you must grant

**System Settings → Privacy & Security → Screen Recording** → enable
this app (it will be listed by whatever binary/process name launched
it — see the packaging note below).

This is the *only* permission the app needs. It does **not** request or
use the Accessibility permission at all, on purpose (see above — AX
can't reliably read PDFKit or Zotero's rendered text, so building
around it would make the tool unreliable exactly where it matters most).

If you click **Narrate Frontmost Window** before granting access, the
app will:

1. Call `CGRequestScreenCaptureAccess()`, which shows the native macOS
   permission dialog *the first time only*.
2. If access is still not granted (e.g. you dismissed the dialog, or
   macOS silently refused because you'd denied it before), show an
   in-app alert explaining why, with a button that opens System
   Settings → Privacy & Security → Screen Recording directly
   (`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`).
3. You can also proactively open that same pane from the menu item
   **"Open Screen Recording Settings…"**.

After granting access in System Settings, **quit and relaunch** the app
— Screen Recording grants are cached per-process launch and won't take
effect on an already-running process.

Note: because this is run as a raw SwiftPM executable rather than a
signed `.app` bundle (see Limitations), the entry macOS shows you in the
Screen Recording list will be named after the built binary
(`NarrateHelper`) or, depending on how you launched it, the enclosing
shell — this is a packaging quirk that goes away with proper `.app`
bundling in v2.

## Limitations (v1)

- **OCR, not exact text extraction.** Recognized text can contain
  mistakes, especially with unusual fonts, tight columns, footnotes, or
  math/formula-heavy PDF pages. This is fundamentally different from the
  Chrome extension's PDF.js-based reader, which extracts exact text.
- **No synced highlighting.** The extension highlights the sentence
  being read as it reads it; this helper has no notion of on-screen text
  position, so it just speaks straight through with no visual sync.
- **Whole-window only.** It reads everything Vision finds in the
  frontmost window's screenshot, not a specific selection — there's no
  way (yet) to narrate just a highlighted passage in a native app.
- **Not packaged for distribution.** This is a `swift build` executable,
  not a code-signed, notarized `.app` you could hand to another Mac and
  have Gatekeeper accept. Running it currently requires building it
  from source on the machine that will run it.
- **Menu-bar icon identity is unstable across rebuilds** for the same
  packaging reason — see the note at the end of the Permissions section.

## What v2 could add

- **A real `.app` bundle**: proper `Info.plist`, app icon, and
  packaging (via `xcodebuild` or a bundling script around the SwiftPM
  build output) so the app has a stable identity in System Settings and
  can be code-signed and notarized for distribution outside this
  machine.
- **Native Messaging bridge to the Chrome extension**, so the extension
  and this helper could share one settings/voice UI, and so "narrate
  this" could become a single consistent action whether the content is
  a web page, a browser-opened PDF, or a native app window.
- **ScreenCaptureKit** instead of `CGWindowListCreateImage`, once the
  app is bundled properly, for a more future-proof capture path (Apple
  has signaled the older API's eventual removal) and finer control over
  capture options (e.g. excluding the app's own UI, cursor visibility).
- **Selection-only capture** (e.g. a captured region instead of the
  whole window) so a user could OCR-and-read just a paragraph, closer to
  the extension's highlight-to-narrate UX.
