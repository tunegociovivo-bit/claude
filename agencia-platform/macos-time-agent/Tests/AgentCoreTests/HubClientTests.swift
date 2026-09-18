import XCTest
@testable import AgentCore

final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class HubClientTests: XCTestCase {
    private var session: URLSession!
    private var hub: HubClient!
    override func setUp() {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        session = URLSession(configuration: config); hub = HubClient(token: "test-only-token", session: session)
    }
    override func tearDown() { session.invalidateAndCancel(); StubProtocol.handler = nil }
    func testAuthorizationAndPolicy() async throws {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.host, "hub.negociovivo.app")
            XCTAssertEqual(request.url?.path, "/api/v1/time-tracking/agent-config")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only-token")
            return (200, Data("{\"trackingEnabled\":true,\"screenshotsEnabled\":false}".utf8))
        }
        let result = try await hub.policy(); XCTAssertTrue(result.trackingEnabled); XCTAssertFalse(result.screenshotsEnabled)
    }
    func testDayUsesLocalCalendarBounds() async throws {
        StubProtocol.handler = { request in
            let params = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertEqual(Set(params.map(\.name)), Set(["dayStart", "dayEnd"]))
            let dates = params.compactMap { ISO8601DateFormatter().date(from: $0.value!) }
            XCTAssertEqual(dates.count, 2)
            return (200, Data("{\"startedAt\":null,\"workedSec\":0,\"active\":false}".utf8))
        }
        let result = try await hub.day(); XCTAssertEqual(result.workedSec, 0)
    }
    func testHTTPFailurePropagates() async {
        StubProtocol.handler = { _ in (503, Data()) }
        do { _ = try await hub.policy(); XCTFail("Unconfirmed operation must fail") }
        catch HubError.status(503) { }
        catch { XCTFail("Unexpected error: \(error)") }
    }
    func testConflictPropagatesForStateReconciliation() async {
        StubProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            return (409, Data())
        }
        do { try await hub.action("stop", deviceID: "test-device"); XCTFail("Conflict must be reconciled by caller") }
        catch HubError.status(409) { }
        catch { XCTFail("Unexpected error: \(error)") }
    }
}
