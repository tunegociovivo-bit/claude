import XCTest
@testable import AgentCore

final class DayStateTests: XCTestCase {
    func testActiveAccumulatesOnlySinceServerSnapshot() {
        var state = DayState()
        state.apply(DaySummary(startedAt: "2026-09-18T07:00:00Z", workedSec: 3600, active: true), uptime: 100, finishedToday: false)
        XCTAssertEqual(state.seconds(at: 130), 3630)
        XCTAssertEqual(state.seconds(at: 500), 3690)
    }
    func testPauseAndOfflineDoNotAccumulate() {
        var state = DayState()
        state.apply(DaySummary(startedAt: nil, workedSec: 123, active: false), uptime: 100, finishedToday: false)
        XCTAssertEqual(state.seconds(at: 200), 123)
        state.apply(DaySummary(startedAt: nil, workedSec: 123, active: true), uptime: 100, finishedToday: false)
        state.disconnect()
        XCTAssertEqual(state.seconds(at: 200), 123)
    }
    func testFinalizedCounterResetsWithoutErasingSummary() {
        var state = DayState()
        state.apply(DaySummary(startedAt: nil, workedSec: 28800, active: false), uptime: 100, finishedToday: true)
        XCTAssertEqual(state.seconds(at: 200), 0)
        XCTAssertEqual(state.summary.workedSec, 28800)
        state.apply(DaySummary(startedAt: nil, workedSec: 28800, active: true), uptime: 200, finishedToday: true)
        XCTAssertFalse(state.finished)
    }
    func testDSTDayBoundaries() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Madrid")!
        for (text, hours) in [("2026-03-29T12:00:00Z", 23), ("2026-10-25T12:00:00Z", 25)] {
            let bounds = DayState.bounds(now: ISO8601DateFormatter().date(from: text)!, calendar: calendar)
            XCTAssertEqual(bounds.1.timeIntervalSince(bounds.0), Double(hours * 3600))
        }
    }
    func testIncompletePolicyRejected() {
        XCTAssertThrowsError(try JSONDecoder().decode(AgentPolicy.self, from: Data("{}".utf8)))
        XCTAssertThrowsError(try JSONDecoder().decode(AgentPolicy.self, from: Data("{\"trackingEnabled\":true}".utf8)))
    }
    func testExcludedAppsAndFormatting() throws {
        let policy = try JSONDecoder().decode(AgentPolicy.self, from: Data("{\"trackingEnabled\":true,\"screenshotsEnabled\":true,\"excludedApps\":[\"Keychain\",\"\"]}".utf8))
        XCTAssertTrue(policy.excludes("KEYCHAIN Access"))
        XCTAssertFalse(policy.excludes("Safari"))
        XCTAssertEqual(DayState.format(3661), "01:01:01")
    }
}
