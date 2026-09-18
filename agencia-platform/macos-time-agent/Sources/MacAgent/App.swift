import AppKit
import SwiftUI

@main struct NegocioVivoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AgentModel()
    var body: some Scene {
        Window("Negocio Vivo · Control horario", id: "worker") {
            WorkerView(model: model).onAppear { delegate.model = model; model.boot() }
        }
        .defaultSize(width: 480, height: 620)
        .windowResizability(.contentMinSize)
        MenuBarExtra {
            MenuContent(model: model)
        } label: {
            if let logo = NSImage(named: "AppIcon") {
                Image(nsImage: logo).resizable().frame(width: 20, height: 20)
            } else { Image(systemName: "clock") }
        }
    }
}

struct MenuContent: View {
    @ObservedObject var model: AgentModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(model.status + " · " + model.displayTime)
        Button("Abrir Control horario") { openWindow(id: "worker"); NSApp.activate(ignoringOtherApps: true) }
        Divider()
        Button("Iniciar") { Task { await model.perform("start") } }.disabled(!model.canStart)
        Button(model.state.summary.active ? "Pausar" : "Reanudar") { Task { await model.perform("pause") } }.disabled(!model.canPause)
        Button("Finalizar por hoy") { Task { await model.perform("finish") } }.disabled(!model.canFinish)
        Divider()
        if model.needsCapturePermission {
            Text("Permiso de capturas necesario")
            Button("Permitir capturas en este Mac") { model.permitCapture() }
        }
        Button("Salir") { NSApp.terminate(nil) }
    }
}

struct WorkerView: View {
    @ObservedObject var model: AgentModel
    @State private var credential = ""
    @State private var changingCredential = false
    @State private var confirmFinish = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 14) {
                    Image(nsImage: NSImage(named: "AppIcon") ?? NSImage()).resizable().scaledToFit().frame(width: 58, height: 58)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Negocio Vivo").font(.title2.weight(.semibold))
                        Text("Control horario · Mac").foregroundStyle(.secondary)
                    }
                }
                Divider()
                Label(model.status, systemImage: model.state.summary.active ? "record.circle" : "clock")
                    .font(.headline).accessibilityAddTraits(.updatesFrequently)
                Text(model.startedText).foregroundStyle(.secondary)
                Text(model.displayTime).font(.system(size: 46, weight: .medium, design: .monospaced))
                    .accessibilityLabel("Tiempo trabajado: " + model.displayTime)
                Text("Tiempo trabajado hoy").foregroundStyle(.secondary)
                if model.needsCapturePermission {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Permiso de capturas necesario", systemImage: "exclamationmark.triangle.fill").font(.headline)
                        Text(model.capturePermissionMessage).font(.callout)
                        Button("Permitir capturas en este Mac") { model.permitCapture() }
                            .buttonStyle(.borderedProminent)
                    }
                    .padding().frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.12)).cornerRadius(10)
                }
                VStack(spacing: 10) {
                    Button { Task { await model.perform("start") } } label: {
                        Label("Iniciar", systemImage: "play.fill").frame(maxWidth: .infinity)
                    }.disabled(!model.canStart).buttonStyle(.borderedProminent)
                    Button { Task { await model.perform("pause") } } label: {
                        Label(model.state.summary.active ? "Pausar" : "Reanudar", systemImage: model.state.summary.active ? "pause.fill" : "play.fill").frame(maxWidth: .infinity)
                    }.disabled(!model.canPause)
                    Button { confirmFinish = true } label: {
                        Label("Finalizar por hoy", systemImage: "stop.fill").frame(maxWidth: .infinity)
                    }.disabled(!model.canFinish)
                }.buttonStyle(.bordered).controlSize(.large)
                Text(model.message).font(.callout).textSelection(.enabled)
                if model.linked {
                    Divider()
                    Text(model.captureStatus).font(.callout)
                    Toggle("Abrir al iniciar sesión en el Mac", isOn: Binding(get: { model.loginEnabled }, set: { model.setLogin($0) }))
                    HStack {
                        Button("Actualizar estado") { Task { await model.refresh() } }.disabled(model.busy)
                        Button("Cambiar credencial") { changingCredential.toggle() }.disabled(model.busy || model.state.summary.active || !model.state.online)
                    }
                }
                if !model.linked || changingCredential {
                    SecureField("Credencial individual del CRM", text: $credential)
                    Button("Vincular este Mac") {
                        Task { await model.connect(credential); credential = ""; if model.linked { changingCredential = false } }
                    }.disabled(model.busy || credential.isEmpty)
                }
                Text("Cerrar esta ventana mantiene el programa en la barra superior. Pausa o finaliza para detener el registro.")
                    .font(.footnote).foregroundStyle(.secondary)
            }.padding(26)
        }
        .frame(minWidth: 390, minHeight: 500)
        .tint(Color(red: 0.55, green: 0.36, blue: 0.15))
        .alert("¿Finalizar la jornada de hoy?", isPresented: $confirmFinish) {
            Button("Cancelar", role: .cancel) {}
            Button("Finalizar por hoy") { Task { await model.perform("finish") } }
        } message: { Text("Se guardará el tiempo trabajado y el contador quedará a cero para la próxima jornada.") }
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var model: AgentModel?
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let model else { return .terminateNow }
        if model.busy { return .terminateCancel }
        guard model.state.summary.active || (model.linked && !model.state.online) else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "La jornada puede seguir abierta"
        alert.informativeText = "Pausa o finaliza desde la ventana y espera la confirmación del CRM antes de salir."
        alert.addButton(withTitle: "Volver al programa")
        alert.runModal()
        for window in sender.windows where window.canBecomeMain { window.makeKeyAndOrderFront(nil); break }
        sender.activate(ignoringOtherApps: true)
        return .terminateCancel
    }
}
