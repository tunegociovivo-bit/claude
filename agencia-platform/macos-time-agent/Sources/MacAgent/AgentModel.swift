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
    @Published private(set) var captureError: String?
    @Published private(set) var lastCaptureReceived: Date?
    @Published private(set) var activityError: String?
    private let captureImages: (AgentPolicy) async throws -> [Data]
    private let captureReady: () -> Bool
    @Published private(set) var policy: AgentPolicy?
    @Published private(set) var displayTime = "00:00:00"
    @Published var loginEnabled = SMAppService.mainApp.status == .enabled
    private var hub: HubClient?
    @Published private(set) var capturePermissionGranted = false
    private let capturePermission: () -> Bool
    var needsCapturePermission: Bool { linked && policy?.screenshotsEnabled == true && !capturePermissionGranted }
    let capturePermissionMessage = "Para utilizar el control horario de Negocio Vivo con capturas, es necesario activar «Permitir capturas en este Mac». Sin este permiso no podrás iniciar ni reanudar desde este programa."
    private let defaults: UserDefaults
    init(client: HubClient? = nil, defaults: UserDefaults = .standard, capturePermission: @escaping () -> Bool = { ScreenCapture.permitted }, captureImages: @escaping (AgentPolicy) async throws -> [Data] = { try await ScreenCapture.images(policy: $0) }, captureReady: @escaping () -> Bool = { ScreenCapture.unlocked && !ScreenCapture.idle }) {
        self.defaults = defaults; self.hub = client; self.linked = client != nil
        self.captureImages = captureImages; self.captureReady = captureReady
        self.capturePermission = capturePermission; self.capturePermissionGranted = capturePermission()
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
    var canStart: Bool { linked && !busy && state.online && policy?.trackingEnabled == true && !state.summary.active && (state.finished || state.summary.startedAt == nil) }
    var startLabel: String { state.finished ? "Reabrir jornada" : "Iniciar" }
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
        let permission = capturePermission()
        if permission != capturePermissionGranted {
            capturePermissionGranted = permission
            updateCaptureStatus()
            nextHeartbeat = .distantPast
        }
        let today = Calendar.current.startOfDay(for: Date())
        if today != currentDay {
            currentDay = today; state = DayState(); observedAt = Date(); nextHeartbeat = .distantPast
        }
        displayTime = DayState.format(state.seconds(at: ProcessInfo.processInfo.systemUptime))
        let captureDue = state.summary.active && policy?.screenshotsEnabled == true && Date() >= nextCapture
        if (Date() >= nextHeartbeat || captureDue) && !busy { Task { await refresh() } }
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
            captureError = nil; lastCaptureReceived = nil; activityError = nil
            accept(day); message = "Mac vinculado. Pulsa Iniciar para comenzar."
            observedAt = Date(); nextCapture = Date().addingTimeInterval(policy.captureDelay)
            updateCaptureStatus()
        } catch { message = error.localizedDescription }
    }
    private func accept(_ day: DaySummary) {
        if day.active { defaults.removeObject(forKey: "finishedDay") }
        state.apply(day, uptime: ProcessInfo.processInfo.systemUptime, finishedToday: finishedToday)
        displayTime = DayState.format(state.seconds(at: ProcessInfo.processInfo.systemUptime))
        if state.finished { message = "Jornada guardada: \(DayState.format(day.workedSec)). Puedes reabrir la jornada para seguir sumando horas hoy." }
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
            updateCaptureStatus()
            if start && needsCapturePermission {
                message = capturePermissionMessage
                return
            }
            do { try await hub.action(start ? "start" : "stop", deviceID: deviceID) }
            catch HubError.status(409) { /* Verify the desired state below; another device may have changed it. */ }
            let day = try await hub.day()
            guard day.active == start else { throw HubError.status(409) }
            if action == "finish" {
                defaults.set(currentDay, forKey: "finishedDay")
                message = "Jornada guardada: \(DayState.format(day.workedSec)). Puedes reabrir la jornada para seguir sumando horas hoy."
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
        busy = true; defer {
            busy = false; nextHeartbeat = Date().addingTimeInterval(60)
            // Back off after a failed refresh instead of retrying every timer tick.
            if nextCapture <= Date() { nextCapture = Date().addingTimeInterval(30) }
        }
        do {
            let wasActive = state.summary.active && state.online
            let freshPolicy = try await hub.policy(); policy = freshPolicy
            var day = try await hub.day(); accept(day)
            updateCaptureStatus()
            if day.active && needsCapturePermission {
                do { try await hub.action("stop", deviceID: deviceID) }
                catch HubError.status(409) { /* Confirm the resulting server state below. */ }
                day = try await hub.day(); accept(day)
                guard !day.active else { throw HubError.status(409) }
                observedAt = Date()
                message = "Jornada pausada en el CRM porque falta el permiso de capturas. Actívalo y pulsa Reanudar."
                updateCaptureStatus()
                return
            }
            let now = Date(); let seconds = Int(now.timeIntervalSince(observedAt))
            if wasActive && day.active && freshPolicy.trackingEnabled && seconds > 0 && seconds <= 90 && ScreenCapture.unlocked {
                let app = NSWorkspace.shared.frontmostApplication
                let name = app?.localizedName ?? ""
                let title = ScreenCapture.windowTitle(policy: freshPolicy)
                let excluded = freshPolicy.excludes(name) || freshPolicy.excludes(app?.bundleIdentifier ?? "") || freshPolicy.excludes(title ?? "")
                do {
                    try await hub.activity(deviceID: deviceID, since: observedAt, seconds: seconds,
                    app: !excluded && freshPolicy.collectApps != false ? name : nil,
                    title: excluded ? nil : title,
                    idle: freshPolicy.collectIdle != false && ScreenCapture.idle)
                    activityError = nil
                } catch {
                    activityError = "No se ha enviado la actividad: " + error.localizedDescription
                }
            }
            observedAt = now
            if nextCapture == .distantFuture { nextCapture = now.addingTimeInterval(freshPolicy.captureDelay) }
            updateCaptureStatus()
            if day.active && freshPolicy.trackingEnabled && freshPolicy.screenshotsEnabled && now >= nextCapture {
                await sendCapture(hub: hub, policy: freshPolicy)
            }
            if !state.finished { message = needsCapturePermission ? capturePermissionMessage : "Estado sincronizado con el CRM." }
        } catch {
            observedAt = Date(); state.disconnect()
            message = error.localizedDescription + " Se muestra el último tiempo confirmado."
            captureStatus = "Capturas detenidas hasta recuperar la conexión"
        }
    }
    var canTestCapture: Bool {
        linked && !busy && state.online && state.summary.active && policy?.trackingEnabled == true && policy?.screenshotsEnabled == true && capturePermissionGranted
    }
    func testCapture() async {
        guard canTestCapture else { return }
        nextCapture = .distantPast
        await refresh()
    }
    private func sendCapture(hub: HubClient, policy: AgentPolicy) async {
        nextCapture = Date().addingTimeInterval(30)
        guard capturePermission(), captureReady() else { updateCaptureStatus(); return }
        var phase = "obtener la imagen del Mac"
        do {
            let capturedAt = Date()
            let images = try await captureImages(policy)
            guard !images.isEmpty else {
                captureError = "El Mac no ha entregado ninguna imagen. Comprueba el permiso de pantalla y las aplicaciones excluidas. Se reintentará automáticamente."
                return
            }
            for jpeg in images {
                guard capturePermission(), captureReady() else { updateCaptureStatus(); return }
                phase = "comprobar la jornada antes del envío"
                let uploadPolicy = try await hub.policy()
                let uploadDay = try await hub.day(); accept(uploadDay)
                guard uploadDay.active, uploadPolicy.trackingEnabled, uploadPolicy.screenshotsEnabled,
                      uploadPolicy.blurScreenshots == policy.blurScreenshots,
                      uploadPolicy.excludedApps == policy.excludedApps else { return }
                phase = "enviar la imagen al CRM"
                try await hub.upload(jpeg, deviceID: deviceID, policy: uploadPolicy, date: capturedAt)
                lastCaptureReceived = Date()
            }
            captureError = nil
            nextCapture = capturedAt.addingTimeInterval(policy.captureDelay)
        } catch {
            captureError = "Error al \(phase): \(error.localizedDescription) Se reintentará automáticamente."
        }
        updateCaptureStatus()
    }
    func updateCaptureStatus() {
        capturePermissionGranted = capturePermission()
        if policy?.screenshotsEnabled != true { captureStatus = "Capturas desactivadas por la empresa" }
        else if !capturePermissionGranted { captureStatus = "Capturas: falta el permiso de grabación de pantalla" }
        else if !state.summary.active { captureStatus = "Capturas detenidas" }
        else if !ScreenCapture.unlocked { captureStatus = "Capturas en espera: pantalla bloqueada" }
        else if ScreenCapture.idle { captureStatus = "Capturas en espera: más de 5 minutos sin usar teclado o ratón" }
        else if captureError != nil { captureStatus = "Capturas: hay un envío pendiente de resolver" }
        else { captureStatus = "Capturas programadas durante la jornada" }
    }
    func permitCapture() {
        ScreenCapture.requestPermission()
        updateCaptureStatus()
        message = needsCapturePermission
            ? "Activa Negocio Vivo Control Horario en Ajustes del Sistema > Privacidad y seguridad > Grabación de pantalla. Si macOS solicita reiniciar el programa, sigue sus indicaciones."
            : "Permiso de capturas concedido. Ya puedes iniciar o reanudar."
        nextHeartbeat = .distantPast
    }
    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginEnabled = SMAppService.mainApp.status == .enabled
            if enabled && !loginEnabled { message = "Completa la autorización en Ajustes del Sistema > General > Ítems de inicio." }
        } catch { loginEnabled = SMAppService.mainApp.status == .enabled; message = error.localizedDescription }
    }
}
