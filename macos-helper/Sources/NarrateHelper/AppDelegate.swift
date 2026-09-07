import AppKit

/// Menu-bar-only app delegate: owns the `NSStatusItem`, wires up the
/// capture -> OCR -> speech pipeline, and handles the Screen Recording
/// permission dance.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var narrateMenuItem: NSMenuItem!
    private var stopMenuItem: NSMenuItem!
    private var statusMenuItem: NSMenuItem!

    private let speaker = Speaker()
    private let workQueue = DispatchQueue(label: "com.narrate.helper.work", qos: .userInitiated)

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu-bar-only: no Dock icon, no app switcher entry.
        NSApp.setActivationPolicy(.accessory)

        buildStatusItem()

        speaker.onFinish = { [weak self] in
            DispatchQueue.main.async {
                self?.setStatus("Idle")
                self?.stopMenuItem.isEnabled = false
            }
        }
    }

    // MARK: - UI setup

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let symbolName = "speaker.wave.2.bubble.left.fill"
            let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Narrate Helper")
            image?.isTemplate = true
            button.image = image
        }

        let menu = NSMenu()

        statusMenuItem = NSMenuItem(title: "Idle", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())

        narrateMenuItem = NSMenuItem(
            title: "Narrate Frontmost Window",
            action: #selector(narrateFrontmostWindow),
            keyEquivalent: "n"
        )
        narrateMenuItem.target = self
        menu.addItem(narrateMenuItem)

        stopMenuItem = NSMenuItem(
            title: "Stop",
            action: #selector(stopNarration),
            keyEquivalent: "."
        )
        stopMenuItem.target = self
        stopMenuItem.isEnabled = false
        menu.addItem(stopMenuItem)

        menu.addItem(.separator())

        let permissionItem = NSMenuItem(
            title: "Open Screen Recording Settings…",
            action: #selector(openScreenRecordingSettings),
            keyEquivalent: ""
        )
        permissionItem.target = self
        menu.addItem(permissionItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Narrate Helper", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    // MARK: - Actions

    @objc private func narrateFrontmostWindow() {
        guard ScreenCapture.hasPermission() else {
            setStatus("Requesting permission…")
            let granted = ScreenCapture.requestPermission()
            if !granted {
                showPermissionAlert()
                setStatus("Idle")
            }
            return
        }

        setStatus("Capturing window…")
        narrateMenuItem.isEnabled = false

        workQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let image = try ScreenCapture.captureFrontmostWindow()

                DispatchQueue.main.async { self.setStatus("Recognizing text…") }
                let text = try TextRecognizer.recognizeText(in: image)

                DispatchQueue.main.async {
                    self.setStatus("Speaking…")
                    self.narrateMenuItem.isEnabled = true
                    self.stopMenuItem.isEnabled = true
                    self.speaker.speak(text)
                }
            } catch {
                DispatchQueue.main.async {
                    self.narrateMenuItem.isEnabled = true
                    self.setStatus("Idle")
                    self.showErrorAlert(error)
                }
            }
        }
    }

    @objc private func stopNarration() {
        speaker.stop()
        stopMenuItem.isEnabled = false
        setStatus("Idle")
    }

    @objc private func openScreenRecordingSettings() {
        ScreenCapture.openScreenRecordingSettings()
    }

    @objc private func quit() {
        speaker.stop()
        NSApp.terminate(nil)
    }

    // MARK: - Helpers

    private func setStatus(_ text: String) {
        statusMenuItem.title = text
    }

    private func showPermissionAlert() {
        let alert = NSAlert()
        alert.messageText = "Screen Recording Access Needed"
        alert.informativeText = """
        Narrate Helper reads other apps' windows by taking a screenshot and running OCR on it — it never inspects those apps internally — so macOS requires explicit Screen Recording permission.

        Open System Settings > Privacy & Security > Screen Recording, enable Narrate Helper, then quit and relaunch this app.
        """
        alert.alertStyle = .informational
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            ScreenCapture.openScreenRecordingSettings()
        }
    }

    private func showErrorAlert(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Couldn't Narrate That Window"
        alert.informativeText = "\(error)"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
