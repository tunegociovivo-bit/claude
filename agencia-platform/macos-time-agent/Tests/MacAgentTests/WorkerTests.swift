import XCTest
import SwiftUI
import AppKit
import AgentCore
@testable import MacAgent

final class WorkerProtocol: URLProtocol {
    static var active = false
    static var started = false
    static var worked = 0
    static var failStop = false
    static var failStart = false
    static var workedOnStop = 3600
    static var conflict = false
    static var screenshotsEnabled = false
    static var starts = 0
    static var screenshotTimes: [Date] = []
    static var failUpload = false
    static var failActivity = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var status = 200
        var json = "{}"
        let path = request.url!.path
        if path.hasSuffix("agent-config") { json = "{\"trackingEnabled\":true,\"screenshotsEnabled\":\(Self.screenshotsEnabled),\"screenshotInterval\":2,\"screenshotJitter\":0}" }
        else if request.httpMethod == "POST" && path.hasSuffix("/screenshots") {
            if Self.failUpload { status = 503 } else { Self.screenshotTimes.append(Date()) }
        }
        else if request.httpMethod == "POST" && path.hasSuffix("/activity") && Self.failActivity { status = 503 }
        else if path.hasSuffix("/me") {
            json = "{\"active\":\(Self.active),\"workedSec\":\(Self.worked),\"startedAt\":\(Self.started ? "\"2026-09-18T07:00:00Z\"" : "null")}"
        } else if request.httpMethod == "POST" && path.hasSuffix("time-tracking") {
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            if body?["action"] == "start" {
                if Self.failStart { status = 503 }
                else { Self.active = true; Self.started = true; Self.starts += 1 }
            }
            else if Self.failStop { status = 503 }
            else { Self.active = false; Self.worked = Self.workedOnStop }
            if Self.conflict { status = 409 }
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class WorkerTests: XCTestCase {
    private func model(permission: @escaping () -> Bool = { true }, images: @escaping (AgentPolicy) async throws -> [Data] = { try await ScreenCapture.images(policy: $0) }, ready: @escaping () -> Bool = { ScreenCapture.unlocked && !ScreenCapture.idle }) -> AgentModel {
        WorkerProtocol.active = false; WorkerProtocol.started = false; WorkerProtocol.worked = 0
        WorkerProtocol.failStop = false; WorkerProtocol.conflict = false
        WorkerProtocol.failStart = false; WorkerProtocol.workedOnStop = 3600
        WorkerProtocol.screenshotsEnabled = false; WorkerProtocol.starts = 0
        WorkerProtocol.screenshotTimes = []
        WorkerProtocol.failUpload = false; WorkerProtocol.failActivity = false
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [WorkerProtocol.self]
        let defaults = UserDefaults(suiteName: "NV.Tests." + UUID().uuidString)!
        return AgentModel(client: HubClient(token: "test-only", session: URLSession(configuration: configuration)), defaults: defaults, capturePermission: permission, captureImages: images, captureReady: ready)
    }
    func testCaptureFailureSurvivesRefreshAndClearsOnlyAfterConfirmedUpload() async {
        let model = model(images: { _ in [Data([1, 2, 3])] }, ready: { true })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start")
        WorkerProtocol.failUpload = true
        await model.testCapture()
        XCTAssertNotNil(model.captureError)
        XCTAssertNil(model.lastCaptureReceived)
        XCTAssertTrue(model.state.online, "Screenshot failure must not disconnect confirmed time tracking")
        await model.refresh()
        XCTAssertNotNil(model.captureError, "Routine sync must not erase screenshot failures")
        WorkerProtocol.failUpload = false
        await model.testCapture()
        XCTAssertNil(model.captureError)
        XCTAssertNotNil(model.lastCaptureReceived)
        XCTAssertEqual(WorkerProtocol.screenshotTimes.count, 1)
    }
    func testEmptyCaptureIsVisibleAndPausedSessionCannotSend() async {
        let model = model(images: { _ in [] }, ready: { true })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start"); await model.testCapture()
        XCTAssertTrue(model.captureError?.contains("ninguna imagen") == true)
        XCTAssertNil(model.lastCaptureReceived)
        await model.perform("pause"); await model.testCapture()
        XCTAssertFalse(model.canTestCapture)
        XCTAssertEqual(WorkerProtocol.screenshotTimes.count, 0)
    }
    func testActivityFailureDoesNotPreventScreenshotUpload() async throws {
        let model = model(images: { _ in [Data([1, 2, 3])] }, ready: { true })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start")
        WorkerProtocol.failActivity = true
        try await Task.sleep(nanoseconds: 1_100_000_000)
        await model.testCapture()
        XCTAssertNotNil(model.activityError)
        XCTAssertNotNil(model.lastCaptureReceived)
        XCTAssertTrue(model.state.online)
    }
    func testDeniedPermissionBlocksStartAndResumeUntilGranted() async {
        var permitted = false
        let model = model(permission: { permitted })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh()
        XCTAssertTrue(model.needsCapturePermission)
        await model.perform("start")
        XCTAssertEqual(WorkerProtocol.starts, 0)
        XCTAssertFalse(WorkerProtocol.active)
        XCTAssertTrue(model.state.online)
        permitted = true
        await model.perform("start")
        XCTAssertTrue(WorkerProtocol.active)
        XCTAssertFalse(model.needsCapturePermission)
        await model.perform("pause")
        permitted = false
        await model.perform("pause")
        XCTAssertEqual(WorkerProtocol.starts, 1)
        XCTAssertFalse(WorkerProtocol.active)
        await model.perform("finish")
        XCTAssertTrue(model.state.finished)
    }
    func testRevokingPermissionPausesConfirmedSessionWithoutErasingTime() async {
        var permitted = true
        let model = model(permission: { permitted })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start")
        permitted = false
        await model.refresh()
        XCTAssertTrue(model.needsCapturePermission)
        XCTAssertFalse(WorkerProtocol.active)
        XCTAssertFalse(model.state.summary.active)
        XCTAssertTrue(model.state.online)
        XCTAssertEqual(model.state.summary.workedSec, 3600)
        permitted = true
        await model.refresh()
        XCTAssertFalse(WorkerProtocol.active, "Permission grant must not resume automatically")
        await model.perform("pause")
        XCTAssertTrue(WorkerProtocol.active)
    }
    func testFailedPermissionPauseIsNotReportedAsConfirmed() async {
        var permitted = true
        let model = model(permission: { permitted })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start")
        permitted = false; WorkerProtocol.failStop = true
        await model.refresh()
        XCTAssertTrue(WorkerProtocol.active)
        XCTAssertFalse(model.state.online)
        XCTAssertFalse(model.message.contains("Jornada pausada en el CRM"))
        WorkerProtocol.failStop = false
        await model.refresh()
        XCTAssertFalse(WorkerProtocol.active)
        XCTAssertTrue(model.state.online)
    }
    func testCompanyCanDisableCaptureRequirement() async {
        let model = model(permission: { false })
        await model.refresh(); await model.perform("start")
        XCTAssertFalse(model.needsCapturePermission)
        XCTAssertTrue(WorkerProtocol.active)
    }
    func testWholeDay() async {
        let model = model(); await model.refresh()
        XCTAssertTrue(model.canStart); XCTAssertFalse(model.canPause)
        await model.perform("start"); XCTAssertTrue(model.state.summary.active)
        await model.perform("pause"); XCTAssertFalse(model.state.summary.active)
        XCTAssertEqual(model.displayTime, "01:00:00")
        await model.perform("pause"); XCTAssertTrue(model.state.summary.active)
        await model.perform("finish"); XCTAssertTrue(model.state.finished)
        XCTAssertEqual(model.displayTime, "00:00:00"); XCTAssertEqual(model.state.summary.workedSec, 3600)
        XCTAssertTrue(model.canStart); XCTAssertFalse(model.canPause)
        await model.refresh(); XCTAssertTrue(model.state.finished)
        WorkerProtocol.active = true; await model.refresh(); XCTAssertFalse(model.state.finished)
    }
    func testPeriodicNativeCaptureRepeatsWhileWorking() async throws {
        guard ProcessInfo.processInfo.environment["NV_CAPTURE_CADENCE_TEST"] == "true" else {
            throw XCTSkip("Opt-in extended native cadence diagnostic")
        }
        XCTAssertNil(try CredentialStore.read(), "Diagnostic must not load a real CRM credential")
        guard try CredentialStore.read() == nil else { return }
        _ = NSApplication.shared
        let model = model()
        WorkerProtocol.screenshotsEnabled = true
        model.boot()
        for _ in 0..<30 {
            if model.state.online && !model.busy { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        await model.perform("start")
        XCTAssertTrue(model.state.summary.active)
        WorkerProtocol.failUpload = true
        var recoveredUpload = false
        let start = Date()
        for second in 0..<310 {
            if model.captureError != nil && !recoveredUpload {
                XCTAssertNil(model.lastCaptureReceived)
                WorkerProtocol.failUpload = false
                recoveredUpload = true
            }
            if second % 10 == 0 {
                let event = try XCTUnwrap(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                    mouseCursorPosition: CGPoint(x: 180 + second % 40, y: 180), mouseButton: .left))
                event.post(tap: .cghidEventTap)
            }
            if WorkerProtocol.screenshotTimes.count >= 2 { break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        let times = WorkerProtocol.screenshotTimes
        print("NV_CADENCE captures=\(times.count) offsets=\(times.map { $0.timeIntervalSince(start) }) message=\(model.message) captureStatus=\(model.captureStatus)")
        for _ in 0..<50 {
            if !model.busy { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        await model.perform("finish")
        XCTAssertTrue(recoveredUpload, "An initial upload failure must be retried automatically")
        XCTAssertNil(model.captureError)
        XCTAssertGreaterThanOrEqual(times.count, 2, "Native periodic capture must repeat; one image is insufficient")
        if times.count >= 2 {
            XCTAssertGreaterThan(times[1].timeIntervalSince(times[0]), 110)
            XCTAssertLessThan(times[1].timeIntervalSince(times[0]), 150)
        }
    }
    func testFailedFinishDoesNotEraseTimeOrMarkComplete() async {
        let model = model(); await model.refresh(); await model.perform("start")
        WorkerProtocol.failStop = true; await model.perform("finish")
        XCTAssertFalse(model.state.finished); XCTAssertFalse(model.state.online)
        XCTAssertTrue(WorkerProtocol.active)
    }
    func testReopenFinishedDayPreservesTotalAndAddsNewTime() async {
        let model = model(); await model.refresh(); await model.perform("start")
        await model.perform("finish")
        XCTAssertEqual(model.startLabel, "Reabrir jornada")
        XCTAssertEqual(model.state.summary.workedSec, 3600)
        await model.perform("start")
        XCTAssertTrue(model.state.summary.active)
        XCTAssertFalse(model.state.finished)
        XCTAssertEqual(model.displayTime, "01:00:00")
        WorkerProtocol.workedOnStop = 5400
        await model.perform("finish")
        XCTAssertEqual(model.state.summary.workedSec, 5400)
        await model.perform("start")
        XCTAssertEqual(model.displayTime, "01:30:00")
        XCTAssertEqual(WorkerProtocol.starts, 3)
    }
    func testReopenStillRequiresCapturePermissionAndServerConfirmation() async {
        var permitted = true
        let model = model(permission: { permitted })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh(); await model.perform("start"); await model.perform("finish")
        permitted = false
        await model.perform("start")
        XCTAssertTrue(model.state.finished)
        XCTAssertFalse(WorkerProtocol.active)
        XCTAssertEqual(WorkerProtocol.starts, 1)
        permitted = true; WorkerProtocol.failStart = true
        await model.perform("start")
        XCTAssertTrue(model.state.finished)
        XCTAssertFalse(model.state.online)
        WorkerProtocol.failStart = false
        await model.refresh()
        XCTAssertTrue(model.state.finished)
        await model.perform("start")
        XCTAssertFalse(model.state.finished)
        XCTAssertTrue(model.state.summary.active)
        XCTAssertEqual(model.state.summary.workedSec, 3600)
    }
    func testPersistedFinishedDayCanBeReopenedAfterAppRestart() async throws {
        _ = model()
        WorkerProtocol.started = true; WorkerProtocol.worked = 7200
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [WorkerProtocol.self]
        let suite = "NV.Reopen." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Calendar.current.startOfDay(for: Date()), forKey: "finishedDay")
        let restarted = AgentModel(client: HubClient(token: "test-only", session: URLSession(configuration: config)), defaults: defaults)
        await restarted.refresh()
        XCTAssertTrue(restarted.state.finished)
        XCTAssertTrue(restarted.canStart)
        await restarted.perform("start")
        XCTAssertTrue(restarted.state.summary.active)
        XCTAssertEqual(restarted.displayTime, "02:00:00")
        XCTAssertNil(defaults.object(forKey: "finishedDay"))
    }
    func testYesterdayFinishedMarkerAllowsNewDay() async throws {
        _ = model()
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [WorkerProtocol.self]
        let suite = "NV.NextDay." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Calendar.current.date(byAdding: .day, value: -1, to: Calendar.current.startOfDay(for: Date()))!, forKey: "finishedDay")
        let nextDay = AgentModel(client: HubClient(token: "test-only", session: URLSession(configuration: config)), defaults: defaults)
        await nextDay.refresh()
        XCTAssertFalse(nextDay.state.finished)
        XCTAssertEqual(nextDay.displayTime, "00:00:00")
        XCTAssertTrue(nextDay.canStart)
        await nextDay.perform("start")
        XCTAssertTrue(nextDay.state.summary.active)
    }
    func testConsoleDetectionUsesPlatformKey() throws {
        let info = try XCTUnwrap(CGSessionCopyCurrentDictionary() as? [String: Any])
        let onConsole = info[kCGSessionOnConsoleKey] as? Bool == true
        XCTAssertEqual(ScreenCapture.unlocked, onConsole && info["CGSSessionScreenIsLocked"] as? Bool != true)
    }
    func testIdleMeasurementIncludesAllUserInputInsteadOfNullEvents() {
        let recent = ScreenCapture.idleSeconds { source, event in
            XCTAssertEqual(source, .combinedSessionState)
            XCTAssertEqual(event.rawValue, UInt32.max)
            // Reproduce the incident: null events are old while real input is recent.
            return event == .null ? 3600 : 2
        }
        XCTAssertEqual(recent, 2)
        XCTAssertFalse(recent > 300)
        XCTAssertTrue(ScreenCapture.idleSeconds { _, _ in 301 } > 300)
    }
    func testNativeMouseActivityResetsIdleMeasurement() async throws {
        // Only the disposable CI Mac synthesizes input; no CRM data is sent.
        guard ProcessInfo.processInfo.environment["CI"] == "true" else {
            throw XCTSkip("Native input test runs on the disposable Mac runner")
        }
        let event = try XCTUnwrap(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
            mouseCursorPosition: CGPoint(x: 180, y: 180), mouseButton: .left))
        event.post(tap: .cghidEventTap)
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertLessThan(ScreenCapture.idleSeconds(), 5)
        XCTAssertFalse(ScreenCapture.idle)
        XCTAssertTrue(ScreenCapture.permitted, "The CI desktop must already allow capture; do not bypass macOS permission")
        let policy = try JSONDecoder().decode(AgentPolicy.self,
            from: Data("{\"trackingEnabled\":true,\"screenshotsEnabled\":true}".utf8))
        let images = try await ScreenCapture.images(policy: policy)
        XCTAssertFalse(images.isEmpty, "Recent native input must allow a real screen image")
        XCTAssertTrue(images.allSatisfy { $0.count > 1000 })
        print("NV_IDLE_FIX nativeImages=\(images.count) idleSeconds=\(ScreenCapture.idleSeconds())")
    }
    func testConflictReconcilesConfirmedServerState() async {
        let model = model(); await model.refresh()
        WorkerProtocol.conflict = true; await model.perform("start")
        XCTAssertTrue(model.state.summary.active); XCTAssertTrue(model.state.online)
    }
    func testRenderNativeWindow() async throws {
        _ = NSApplication.shared
        let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let logo = try XCTUnwrap(NSImage(contentsOf: package.appendingPathComponent("assets/logo.png")))
        logo.setName("AppIcon")
        let model = model(permission: { false })
        WorkerProtocol.screenshotsEnabled = true
        await model.refresh()
        XCTAssertTrue(model.needsCapturePermission)
        let host = NSHostingView(rootView: WorkerView(model: model).frame(width: 480, height: 760).background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 760), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(nanoseconds: 300_000_000)
        host.layoutSubtreeIfNeeded(); host.displayIfNeeded()
        let bitmap = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        var colors = Set<String>()
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: 10) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: 10) {
                if let color = bitmap.colorAt(x: x, y: y), color.alphaComponent > 0.5 { colors.insert(color.description) }
            }
        }
        XCTAssertGreaterThan(colors.count, 20, "Native preview must contain visible content, not a blank image")
        if let directory = ProcessInfo.processInfo.environment["MAC_PREVIEW_DIR"] {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent("mac-native-window.png"))
        }
        XCTAssertGreaterThan(png.count, 1000)
    }
}
