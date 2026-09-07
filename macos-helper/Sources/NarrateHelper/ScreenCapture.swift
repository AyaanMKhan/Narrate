import AppKit
import CoreGraphics

/// Captures the frontmost on-screen window as a `CGImage`.
///
/// We use the older `CGWindowListCreateImage` API (deprecated on macOS 14+
/// in favor of ScreenCaptureKit) rather than ScreenCaptureKit because:
///   - It is synchronous and needs no async stream/delegate setup.
///   - It works from a plain SwiftPM executable with no Info.plist,
///     no entitlements file, and no app-bundle packaging — just the
///     Screen Recording permission grant.
///   - ScreenCaptureKit's `SCShareableContent` / `SCStream` APIs are
///     considerably more machinery for a v1 whose only job is "grab
///     one frame of the frontmost window." A v2 packaged as a real
///     signed .app is the right time to move to ScreenCaptureKit.
///
/// It still requires the user to grant this process Screen Recording
/// access in System Settings -> Privacy & Security -> Screen Recording.
enum ScreenCapture {

    enum CaptureError: Error, CustomStringConvertible {
        case permissionDenied
        case noFrontmostWindow
        case captureFailed

        var description: String {
            switch self {
            case .permissionDenied:
                return "Screen Recording permission has not been granted."
            case .noFrontmostWindow:
                return "Could not find a frontmost window to capture."
            case .captureFailed:
                return "CGWindowListCreateImage returned no image."
            }
        }
    }

    /// Returns true if this process currently holds Screen Recording access,
    /// without prompting the user.
    static func hasPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Prompts the user for Screen Recording access if not already granted.
    /// The system only shows the native prompt the *first* time a process
    /// asks; after a denial, macOS silently refuses further prompts and the
    /// user must flip the toggle in System Settings themselves, so we also
    /// open the relevant pane directly to make that as easy as possible.
    @discardableResult
    static func requestPermission() -> Bool {
        let granted = CGRequestScreenCaptureAccess()
        if !granted {
            openScreenRecordingSettings()
        }
        return granted
    }

    static func openScreenRecordingSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Finds the window ID of the topmost, on-screen, "normal" window that
    /// does not belong to this helper app itself.
    private static func frontmostCapturableWindowID() -> CGWindowID? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let infoList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        let ownPID = ProcessInfo.processInfo.processIdentifier

        // CGWindowListCopyWindowInfo returns windows already ordered
        // front-to-back, so the first "normal" window (layer 0) that isn't
        // ours is the frontmost user-visible window.
        for info in infoList {
            guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
            guard let pid = info[kCGWindowOwnerPID as String] as? Int32, pid != ownPID else { continue }
            guard let windowID = info[kCGWindowNumber as String] as? CGWindowID else { continue }

            // Skip windows with no meaningful on-screen area (e.g. hidden
            // helper windows some apps keep around).
            if let boundsDict = info[kCGWindowBounds as String] as? [String: CGFloat],
               let width = boundsDict["Width"], let height = boundsDict["Height"],
               width < 10 || height < 10 {
                continue
            }

            return windowID
        }
        return nil
    }

    /// Captures the frontmost window and returns its image at full
    /// resolution (Retina-aware via `.bestResolution`).
    static func captureFrontmostWindow() throws -> CGImage {
        guard hasPermission() else {
            throw CaptureError.permissionDenied
        }
        guard let windowID = frontmostCapturableWindowID() else {
            throw CaptureError.noFrontmostWindow
        }

        // Passing .null for screenBounds tells CGWindowListCreateImage to
        // use the target window's own bounds rather than a screen rect.
        let imageOptions: CGWindowImageOption = [.boundsIgnoreFraming, .bestResolution]
        guard let image = CGWindowListCreateImage(
            .null,
            .optionIncludingWindow,
            windowID,
            imageOptions
        ) else {
            throw CaptureError.captureFailed
        }
        return image
    }
}
