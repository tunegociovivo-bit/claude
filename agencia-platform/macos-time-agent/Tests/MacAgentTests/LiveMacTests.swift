import XCTest
import AppKit
import AgentCore
@testable import MacAgent

final class LiveRequestObserver: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var counts: [String: Int] = [:]
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard error == nil, let response = task.response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode), let path = task.originalRequest?.url?.path else { return }
        lock.lock(); counts[path, default: 0] += 1; lock.unlock()
    }
    func count(_ path: String) -> Int { lock.lock(); defer { lock.unlock() }; return counts[path, default: 0] }
}

@MainActor final class LiveMacTests: XCTestCase {
    func testAutomaticHeartbeatAndScheduledCapture() async throws {
        guard ProcessInfo.processInfo.environment["NV_PERIODIC"] == "true",
              let token = ProcessInfo.processInfo.environment["NV_LIVE_TOKEN"] else { throw XCTSkip("Authorized periodic test only") }
        let observer = LiveRequestObserver()
        let session = URLSession(configuration: .ephemeral, delegate: observer, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let client = HubClient(token: token, session: session)
        let before = try await client.day()
        guard !before.active else { throw XCTSkip("Existing active shift: no changes") }
        let policy = try await client.policy()
        guard policy.trackingEnabled, policy.screenshotsEnabled, policy.screenshotInterval == 2 else {
            XCTFail("Periodic test requires authorized two-minute capture policy"); return
        }
        let suite = "NV.Periodic." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        let device = "mac-ci-periodic-" + UUID().uuidString
        defaults.set(device, forKey: "deviceID")
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = AgentModel(client: client, defaults: defaults)
        await model.refresh()
        await model.perform(model.canStart ? "start" : "pause")
        guard model.state.summary.active else { XCTFail("Start was not confirmed"); return }
        model.boot()
        do {
            // Let the production one-second timer and 60-second refresh do the work.
            try await Task.sleep(nanoseconds: 190_000_000_000)
            XCTAssertTrue(model.state.online)
            let captures = observer.count("/api/v1/time-tracking/screenshots")
            let activity = observer.count("/api/v1/time-tracking/activity")
            XCTAssertGreaterThanOrEqual(captures, 1, "Production scheduler must upload a real screen capture")
            XCTAssertGreaterThanOrEqual(activity, 2, "Production timer must send repeated heartbeats")
            await model.perform("pause")
            XCTAssertFalse(model.state.summary.active)
            let paused = try await client.day()
            let capturesAtPause = observer.count("/api/v1/time-tracking/screenshots")
            let activityAtPause = observer.count("/api/v1/time-tracking/activity")
            try await Task.sleep(nanoseconds: 65_000_000_000)
            XCTAssertEqual(observer.count("/api/v1/time-tracking/screenshots"), capturesAtPause)
            XCTAssertEqual(observer.count("/api/v1/time-tracking/activity"), activityAtPause)
            let stillPaused = try await client.day()
            XCTAssertEqual(stillPaused.workedSec, paused.workedSec)
            await model.perform("finish")
            XCTAssertTrue(model.state.finished)
            print("NV_PROOF automaticCaptures=\(captures) automaticHeartbeats=\(activity) pauseStopsBoth=true device=\(device)")
        } catch { try? await client.action("stop", deviceID: device); throw error }
        if try await client.day().active { try await client.action("stop", deviceID: device) }
    }
    func testRealCRMDayAndScreenshot() async throws {
        guard let token = ProcessInfo.processInfo.environment["NV_LIVE_TOKEN"], !token.isEmpty else {
            throw XCTSkip("Live CRM credential is supplied only in the authorized manual workflow")
        }
        let client = HubClient(token: token)
        let before = try await client.day()
        guard !before.active else { throw XCTSkip("Existing active shift: no changes made") }
        let policy = try await client.policy()
        XCTAssertTrue(policy.trackingEnabled)
        XCTAssertTrue(policy.screenshotsEnabled)
        guard policy.trackingEnabled && policy.screenshotsEnabled else { return }
        let suite = "NV.LiveTest." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        let device = "mac-ci-live-" + UUID().uuidString
        defaults.set(device, forKey: "deviceID")
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = AgentModel(client: client, defaults: defaults)
        await model.refresh()
        // Resume today's existing total, or start if this is the first entry.
        await model.perform(model.canStart ? "start" : "pause")
        XCTAssertTrue(model.state.summary.active)
        guard model.state.summary.active else { XCTFail("CRM did not confirm start"); return }
        do {
            try await Task.sleep(nanoseconds: 4_000_000_000)
            await model.refresh()
            XCTAssertTrue(model.state.online, "Actual heartbeat must be accepted")
            await model.perform("pause")
            XCTAssertFalse(model.state.summary.active)
            let paused = try await client.day()
            try await Task.sleep(nanoseconds: 3_000_000_000)
            let stillPaused = try await client.day()
            XCTAssertEqual(paused.workedSec, stillPaused.workedSec, "Pause must freeze server time")
            await model.perform("pause")
            XCTAssertTrue(model.state.summary.active)

            _ = NSApplication.shared
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
            window.title = "Negocio Vivo - PRUEBA MAC AUTORIZADA"
            let label = NSTextField(labelWithString: "PRUEBA MAC NEGOCIO VIVO\nEscritorio de pruebas, sin datos de trabajadores")
            label.frame = NSRect(x: 30, y: 120, width: 660, height: 180)
            label.font = NSFont.systemFont(ofSize: 28)
            window.contentView?.addSubview(label)
            window.makeKeyAndOrderFront(nil)
            defer { window.orderOut(nil) }
            try await Task.sleep(nanoseconds: 1_000_000_000)
            let sessionInfo = CGSessionCopyCurrentDictionary() as? [String: Any]
            print("NV_PROOF consoleKey=\(kCGSessionOnConsoleKey) onConsole=\(sessionInfo?[kCGSessionOnConsoleKey] as? Bool ?? false)")
            let native = try await ScreenCapture.images(policy: policy)
            print("NV_PROOF screenPermission=\(ScreenCapture.permitted) unlocked=\(ScreenCapture.unlocked) idle=\(ScreenCapture.idle) nativeImages=\(native.count)")
            if let jpeg = native.first {
                try await client.upload(jpeg, deviceID: device, policy: policy, date: Date())
                print("NV_PROOF actualScreenCaptureUploaded=true")
            } else {
                // Separate proof of the real multipart/storage path from OS capture permission.
                let view = try XCTUnwrap(window.contentView)
                let bitmap = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
                view.cacheDisplay(in: view.bounds, to: bitmap)
                let jpeg = try XCTUnwrap(bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.65]))
                try await client.upload(jpeg, deviceID: device, policy: policy, date: Date())
                print("NV_PROOF syntheticTestWindowUploaded=true actualScreenCaptureUploaded=false")
            }
            XCTAssertFalse(native.isEmpty, "Full capture validation requires a real native screen image")
            try await Task.sleep(nanoseconds: 3_000_000_000)
            await model.perform("finish")
            XCTAssertTrue(model.state.finished)
            XCTAssertEqual(model.displayTime, "00:00:00")
            let ended = try await client.day()
            XCTAssertFalse(ended.active)
            XCTAssertGreaterThan(ended.workedSec, before.workedSec)
            let reopened = AgentModel(client: client, defaults: defaults)
            await reopened.refresh()
            XCTAssertTrue(reopened.state.finished)
            XCTAssertEqual(reopened.displayTime, "00:00:00")
            print("NV_PROOF pauseFrozen=true resumed=true finished=true restartPreserved=true addedSeconds=\(ended.workedSec - before.workedSec) device=\(device)")
        } catch {
            try? await client.action("stop", deviceID: device)
            throw error
        }
        // Ensure a failed assertion never leaves this test's session open.
        if try await client.day().active { try await client.action("stop", deviceID: device) }
    }
}
