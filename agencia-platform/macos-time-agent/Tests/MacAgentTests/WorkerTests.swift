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
    static var conflict = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var status = 200
        var json = "{}"
        let path = request.url!.path
        if path.hasSuffix("agent-config") { json = "{\"trackingEnabled\":true,\"screenshotsEnabled\":false}" }
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
            if body?["action"] == "start" { Self.active = true; Self.started = true }
            else if Self.failStop { status = 503 }
            else { Self.active = false; Self.worked = 3600 }
            if Self.conflict { status = 409 }
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class WorkerTests: XCTestCase {
    private func model() -> AgentModel {
        WorkerProtocol.active = false; WorkerProtocol.started = false; WorkerProtocol.worked = 0
        WorkerProtocol.failStop = false; WorkerProtocol.conflict = false
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [WorkerProtocol.self]
        let defaults = UserDefaults(suiteName: "NV.Tests." + UUID().uuidString)!
        return AgentModel(client: HubClient(token: "test-only", session: URLSession(configuration: configuration)), defaults: defaults)
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
        XCTAssertFalse(model.canStart); XCTAssertFalse(model.canPause)
        await model.refresh(); XCTAssertTrue(model.state.finished)
        WorkerProtocol.active = true; await model.refresh(); XCTAssertFalse(model.state.finished)
    }
    func testFailedFinishDoesNotEraseTimeOrMarkComplete() async {
        let model = model(); await model.refresh(); await model.perform("start")
        WorkerProtocol.failStop = true; await model.perform("finish")
        XCTAssertFalse(model.state.finished); XCTAssertFalse(model.state.online)
        XCTAssertTrue(WorkerProtocol.active)
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
        let model = model(); await model.refresh(); await model.perform("start")
        WorkerProtocol.worked = 3720; await model.refresh()
        let renderer = ImageRenderer(content: WorkerView(model: model).frame(width: 480, height: 760))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.nsImage)
        let data = try XCTUnwrap(image.tiffRepresentation)
        let bitmap = try XCTUnwrap(NSBitmapImageRep(data: data))
        let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
        if let directory = ProcessInfo.processInfo.environment["MAC_PREVIEW_DIR"] {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent("mac-native-window.png"))
        }
        XCTAssertGreaterThan(png.count, 1000)
    }
}
