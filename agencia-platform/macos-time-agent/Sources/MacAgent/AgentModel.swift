import AppKit
import SwiftUI
import ServiceManagement
import AgentCore

@MainActor final class AgentModel: ObservableObject {
    @Published private(set) var state = DayState()
    @Published private(set) var busy = false
    @Published private(set) var linked = false
    @Published private(set) var message = "Vincula tu Mac con la credencial de Control horario del CRM."
    @Published private(set) var captureStatus = "Capturas: pendientes de configuración"
    @Published private(set) var policy: AgentPolicy?
    @Published private(set) var displayTime = "00:00:00"
    @Published var loginEnabled = SMAppService.mainApp.status == .enabled
    private var hub: HubClient?
    private let defaults: UserDefaults
    init(client: HubClient? = nil, defaults: UserDefaults = .standard) {
        self.defaults = defaults; self.hub = client; self.linked = client != nil
    }
    private var timer: Timer?
    private var nextHeartbeat = Date.distantPast
    private var nextCapture = Date.distantFuture
    private var observedAt = Date()
    private var currentDay = Calendar.current.startOfDay(for: Date())
    private var deviceID: String {
        if let id = defaults.string(forKey: "deviceID") { return id }
        let id = UUID().uuidString; defaults.set(id, forKey: "deviceID"); return id
    }
    private var finishedToday: Bool { defaults.object(forKey: "finishedDay") as? Date == currentDay }
    var canStart: Bool { linked && !busy && state.online && policy?.trackingEnabled == true && !state.summary.active && !state.finished && state.summary.startedAt == nil }
    var canPause: Bool { linked && !busy && state.online && !state.finished && (state.summary.active || state.summary.startedAt != nil) }
    var canFinish: Bool { canPause }
    var status: String {
        if !linked { return "Sin vincular" }
        if !state.online { return "Sin conexión confirmada" }
        if state.finished { return "Jornada finalizada" }
        if state.summary.active { return "Trabajando" }
        return state.summary.startedAt == nil ? "Listo para empezar" : "En pausa"
    }
    var startedText: String {
        guard let raw = state.summary.startedAt else { return "Todavía no has iniciado la jornada" }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else { return "Primera entrada registrada en el CRM" }
        return "Primera entrada: " + date.formatted(date: .abbreviated, time: .shortened)
    }
    func boot() {
        guard timer == nil else { return }
        do {
            if let token = try CredentialStore.read() { hub = HubClient(token: token); linked = true }
        } catch { message = "No se ha podido abrir la credencial en el Llavero: \(error.localizedDescription)" }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        Task { await refresh() }
    }
    private func tick() {
        let today = Calendar.current.startOfDay(for: Date())
        if today != currentDay {
            currentDay = today; state = DayState(); observedAt = Date(); nextHeartbeat = .distantPast
        }
        displayTime = DayState.format(state.seconds(at: ProcessInfo.processInfo.systemUptime))
        if Date() >= nextHeartbeat && !busy { Task { await refresh() } }
    }
    func connect(_ raw: String) async {
        guard !busy else { return }
        guard !linked || (state.online && !state.summary.active) else {
            message = "Pausa la jornada y confirma la conexión antes de cambiar de credencial."; return
        }
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, !token.hasPrefix("NV-"), !token.hasPrefix("NVV-"), !token.contains("\n") else {
            message = "Usa la credencial individual de Control horario, no el antiguo código de vinculación."; return
        }
        busy = true; defer { busy = false }
        do {
            let candidate = HubClient(token: token)
            let policy = try await candidate.policy()
            let day = try await candidate.day()
            try CredentialStore.write(token)
            hub = candidate; linked = true; self.policy = policy
            accept(day); message = "Mac vinculado. Pulsa Iniciar para comenzar."
            observedAt = Date(); nextCapture = Date().addingTimeInterval(policy.captureDelay)
            updateCaptureStatus()
        } catch { message = error.localizedDescription }
    }
    private func accept(_ day: DaySummary) {
        if day.active { defaults.removeObject(forKey: "finishedDay") }
        state.apply(day, uptime: ProcessInfo.processInfo.systemUptime, finishedToday: finishedToday)
        displayTime = DayState.format(state.seconds(at: ProcessInfo.processInfo.systemUptime))
        if state.finished { message = "Jornada guardada: \(DayState.format(day.workedSec)). El próximo día empezarás desde cero." }
    }
    func perform(_ action: String) async {
        guard !busy, let hub else { return }
        if action == "start" && !canStart { return }
        if action == "pause" && !canPause { return }
        if action == "finish" && !canFinish { return }
        busy = true; defer { busy = false }
        do {
            policy = try await hub.policy()
            let start = action == "start" || (action == "pause" && !state.summary.active)
            if start && policy?.trackingEnabled != true { throw HubError.status(403) }
            do { try await hub.action(start ? "start" : "stop", deviceID: deviceID) }
            catch HubError.status(409) { /* Verify the desired state below; another device may have changed it. */ }
            let day = try await hub.day()
            guard day.active == start else { throw HubError.status(409) }
            if action == "finish" {
                defaults.set(currentDay, forKey: "finishedDay")
                message = "Jornada guardada: \(DayState.format(day.workedSec)). El próximo día empezarás desde cero."
            } else { message = start ? "Jornada iniciada y confirmada en el CRM." : "Pausa confirmada. La actividad y las capturas están detenidas." }
            accept(day); observedAt = Date()
            if start { nextCapture = Date().addingTimeInterval(policy?.captureDelay ?? 600) }
            updateCaptureStatus()
        } catch {
            state.disconnect(); message = error.localizedDescription + " No se ha confirmado el cambio; actualiza antes de cerrar."
            captureStatus = "Capturas detenidas hasta recuperar la conexión"
        }
    }
    func refresh() async {
        guard !busy, let hub else { return }
        busy = true; defer { busy = false; nextHeartbeat = Date().addingTimeInterval(60) }
        do {
            let wasActive = state.summary.active && state.online
            let freshPolicy = try await hub.policy(); policy = freshPolicy
            let day = try await hub.day(); accept(day)
            let now = Date(); let seconds = Int(now.timeIntervalSince(observedAt))
            if wasActive && day.active && freshPolicy.trackingEnabled && seconds > 0 && seconds <= 90 && ScreenCapture.unlocked {
                let app = NSWorkspace.shared.frontmostApplication
                let name = app?.localizedName ?? ""
                let title = ScreenCapture.windowTitle(policy: freshPolicy)
                let excluded = freshPolicy.excludes(name) || freshPolicy.excludes(app?.bundleIdentifier ?? "") || freshPolicy.excludes(title ?? "")
                try await hub.activity(deviceID: deviceID, since: observedAt, seconds: seconds,
                    app: !excluded && freshPolicy.collectApps != false ? name : nil,
                    title: excluded ? nil : title,
                    idle: freshPolicy.collectIdle != false && ScreenCapture.idle)
            }
            observedAt = now
            if nextCapture == .distantFuture { nextCapture = now.addingTimeInterval(freshPolicy.captureDelay) }
            updateCaptureStatus()
            if day.active && freshPolicy.trackingEnabled && freshPolicy.screenshotsEnabled && now >= nextCapture {
                nextCapture = now.addingTimeInterval(freshPolicy.captureDelay)
                let images = try await ScreenCapture.images(policy: freshPolicy)
                for jpeg in images {
                    guard ScreenCapture.unlocked, !ScreenCapture.idle else { break }
                    // Recheck server state immediately before uploading each display.
                    let uploadPolicy = try await hub.policy()
                    let uploadDay = try await hub.day(); accept(uploadDay)
                    guard uploadDay.active, uploadPolicy.trackingEnabled, uploadPolicy.screenshotsEnabled,
                          uploadPolicy.blurScreenshots == freshPolicy.blurScreenshots,
                          uploadPolicy.excludedApps == freshPolicy.excludedApps else { break }
                    try await hub.upload(jpeg, deviceID: deviceID, policy: uploadPolicy, date: now)
                }
            }
            if !state.finished { message = "Estado sincronizado con el CRM." }
        } catch {
            observedAt = Date(); state.disconnect()
            message = error.localizedDescription + " Se muestra el último tiempo confirmado."
            captureStatus = "Capturas detenidas hasta recuperar la conexión"
        }
    }
    func updateCaptureStatus() {
        if policy?.screenshotsEnabled != true { captureStatus = "Capturas desactivadas por la empresa" }
        else if !ScreenCapture.permitted { captureStatus = "Capturas: falta el permiso de grabación de pantalla" }
        else { captureStatus = state.summary.active ? "Capturas activas durante la jornada" : "Capturas detenidas" }
    }
    func permitCapture() { ScreenCapture.requestPermission(); updateCaptureStatus() }
    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginEnabled = SMAppService.mainApp.status == .enabled
            if enabled && !loginEnabled { message = "Completa la autorización en Ajustes del Sistema > General > Ítems de inicio." }
        } catch { loginEnabled = SMAppService.mainApp.status == .enabled; message = error.localizedDescription }
    }
}
