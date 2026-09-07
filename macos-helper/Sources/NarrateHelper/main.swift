import AppKit

// Plain AppKit lifecycle (NSApplication + a manual delegate) rather than
// SwiftUI's `App` protocol: this is a menu-bar-only agent with no windows
// and no view hierarchy, built and run via `swift build` / `swift run`
// with no Xcode project, storyboard, or asset catalog. NSStatusItem +
// NSApplicationDelegate is the well-trodden path for that and needs
// nothing beyond this file to boot.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
