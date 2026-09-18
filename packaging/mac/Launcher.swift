// IHOP Operations for macOS. A menu bar item that runs the dashboard server (the Node
// program inside this app) with no terminal window, and opens it in the browser.
//
// Everything the person owns lives outside the app, so replacing the app with a newer
// one never touches it:
//   ~/Library/Application Support/IHOP Operations   database, secret key, log
//   ~/Documents/IHOP Operations Reports             reports saved here are imported
import AppKit

let appName = "IHOP Operations"
let port = ProcessInfo.processInfo.environment["PORT"] ?? "4000"
let address = URL(string: "http://localhost:\(port)")!
let fm = FileManager.default
let dataDir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(appName)
let reportsDir = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("\(appName) Reports")
let logFile = dataDir.appendingPathComponent("dashboard.log")
let agentFile = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/com.ihop-operations.dashboard.plist")

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var server: Process?
    var sleepGuard: NSObjectProtocol?
    var stopping = false
    var restarts = 0
    var signalSources: [DispatchSourceSignal] = []
    let statusLine = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
    let loginItem = NSMenuItem(title: "Start When I Log In", action: #selector(toggleLogin), keyEquivalent: "")
    let shareItem = NSMenuItem(title: "Let Others on This Network Open It", action: #selector(toggleSharing), keyEquivalent: "")
    var sharing: Bool { get { UserDefaults.standard.bool(forKey: "shareOnNetwork") } set { UserDefaults.standard.set(newValue, forKey: "shareOnNetwork") } }

    func applicationDidFinishLaunching(_ note: Notification) {
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: reportsDir, withIntermediateDirectories: true)
        buildMenu()
        // Logging out or "kill" ends the app with a signal, not Quit: stop the server then too.
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signalSources.append(source)
        }
        // A second copy (or a copy started at login plus a double-click) just opens the browser.
        answering { up in
            if up { self.statusLine.title = "Running"; self.openDashboard() } else { self.startServer(openWhenReady: !CommandLine.arguments.contains("--background")) }
        }
    }

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image = NSImage(named: "menubar") { image.isTemplate = true; statusItem.button?.image = image } else { statusItem.button?.title = "IHOP" }
        statusItem.button?.toolTip = appName
        let menu = NSMenu()
        menu.autoenablesItems = false // every item stays usable; only the status line is a label
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "o")
        menu.addItem(withTitle: "Show Reports Folder", action: #selector(showReports), keyEquivalent: "")
        menu.addItem(.separator())
        loginItem.state = fm.fileExists(atPath: agentFile.path) ? .on : .off
        menu.addItem(loginItem)
        shareItem.state = sharing ? .on : .off
        menu.addItem(shareItem)
        menu.addItem(withTitle: "Show Log", action: #selector(showLog), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit \(appName)", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items where item.action != nil { item.target = self }
        statusItem.menu = menu
    }

    func startServer(openWhenReady: Bool) {
        let resources = Bundle.main.resourceURL!
        let process = Process()
        process.executableURL = resources.appendingPathComponent("node")
        process.arguments = ["--experimental-sqlite", "--no-warnings", "src/index.js"]
        process.currentDirectoryURL = resources.appendingPathComponent("app/server")
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = port
        env["OPS_DB_PATH"] = dataDir.appendingPathComponent("ops.db").path
        env["OPS_DEFAULT_IMPORT_DIR"] = reportsDir.path
        // This computer only unless sharing is switched on, so macOS never asks about incoming connections.
        if sharing { env.removeValue(forKey: "OPS_HOST") } else { env["OPS_HOST"] = "127.0.0.1" }
        process.environment = env
        rotateLog()
        fm.createFile(atPath: logFile.path, contents: nil)
        if let handle = try? FileHandle(forWritingTo: logFile) { handle.seekToEndOfFile(); process.standardOutput = handle; process.standardError = handle }
        process.terminationHandler = { [weak self] p in DispatchQueue.main.async { self?.serverStopped(status: p.terminationStatus) } }
        do { try process.run() } catch { fail("The dashboard could not start: \(error.localizedDescription)"); return }
        server = process
        // Scheduled refreshes need the Mac awake (the display may still sleep).
        sleepGuard = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled], reason: "Scheduled data refreshes")
        waitUntilUp(tries: 60, open: openWhenReady)
    }

    func waitUntilUp(tries: Int, open: Bool) {
        answering { up in
            if up { self.statusLine.title = "Running at localhost:\(port)"; if open { self.openDashboard() }; self.offerLoginOnce() }
            else if tries > 0 && self.server?.isRunning == true { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitUntilUp(tries: tries - 1, open: open) } }
        }
    }

    func serverStopped(status: Int32) {
        if let guardToken = sleepGuard { ProcessInfo.processInfo.endActivity(guardToken); sleepGuard = nil }
        if stopping { return }
        restarts += status == 0 || status == 15 ? 0 : 1
        if restarts <= 3 { statusLine.title = "Restarting…"; DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.startServer(openWhenReady: false) } }
        else { fail("The dashboard stopped and could not be restarted. Choose Show Log from the menu for the reason.") }
    }

    func answering(_ done: @escaping (Bool) -> Void) {
        var request = URLRequest(url: address.appendingPathComponent("api/auth/me")); request.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let up = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(up) }
        }.resume()
    }

    func rotateLog() {
        if let size = (try? fm.attributesOfItem(atPath: logFile.path))?[.size] as? Int, size > 5_000_000 {
            let old = dataDir.appendingPathComponent("dashboard.old.log")
            try? fm.removeItem(at: old); try? fm.moveItem(at: logFile, to: old)
        }
    }

    func fail(_ message: String) {
        statusLine.title = "Not running"
        let alert = NSAlert(); alert.messageText = appName; alert.informativeText = message; alert.alertStyle = .warning
        NSApp.activate(ignoringOtherApps: true); alert.runModal()
    }

    @objc func openDashboard() { NSWorkspace.shared.open(address) }
    @objc func showReports() { NSWorkspace.shared.open(reportsDir) }
    @objc func showLog() { NSWorkspace.shared.open(logFile) }

    // Asked once, on the first successful start. The morning refresh only happens while the app is running.
    func offerLoginOnce() {
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: "askedAboutLogin") || fm.fileExists(atPath: agentFile.path) { return }
        defaults.set(true, forKey: "askedAboutLogin")
        let alert = NSAlert()
        alert.messageText = "Start \(appName) automatically?"
        alert.informativeText = "The dashboard refreshes its data early each morning and through the day, but only while it is running. Starting it when you log in keeps it current without anyone remembering to open it.\n\nYou can change this later from the menu bar icon."
        alert.addButton(withTitle: "Start When I Log In")
        alert.addButton(withTitle: "Not Now")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn { toggleLogin() }
    }

    // A per-user launch agent: works without an Apple developer signature, unlike a login item.
    @objc func toggleLogin() {
        if fm.fileExists(atPath: agentFile.path) { try? fm.removeItem(at: agentFile); loginItem.state = .off; return }
        let plist: [String: Any] = ["Label": "com.ihop-operations.dashboard", "ProgramArguments": [Bundle.main.executablePath!, "--background"], "RunAtLoad": true, "ProcessType": "Interactive"]
        try? fm.createDirectory(at: agentFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0), (try? data.write(to: agentFile)) != nil { loginItem.state = .on }
    }

    // Off: only this Mac. On: anyone on the office network can open http://<this Mac's name>:4000
    // (macOS may ask once to allow incoming connections). The server restarts to apply it.
    @objc func toggleSharing() {
        sharing.toggle()
        shareItem.state = sharing ? .on : .off
        guard let process = server, process.isRunning else { return }
        restarts = 0
        statusLine.title = "Restarting…"
        process.terminate() // serverStopped() brings it back with the new setting
    }

    @objc func quit() { NSApp.terminate(nil) }

    func applicationWillTerminate(_ note: Notification) {
        stopping = true
        guard let process = server, process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(4)
        while process.isRunning && Date() < deadline { usleep(100_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
    }

    // Double-clicking the app while it is already running opens the dashboard.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { openDashboard(); return false }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu bar only: no Dock icon, no window
app.run()
