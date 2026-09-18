import Foundation

public struct DaySummary: Decodable {
    public let startedAt: String?
    public let workedSec: Int
    public let active: Bool
    public init(startedAt: String?, workedSec: Int, active: Bool) {
        self.startedAt = startedAt; self.workedSec = workedSec; self.active = active
    }
}

public struct DayState {
    public private(set) var summary = DaySummary(startedAt: nil, workedSec: 0, active: false)
    public private(set) var online = false
    public private(set) var finished = false
    private var syncedAt: TimeInterval = 0
    public init() {}
    public mutating func apply(_ value: DaySummary, uptime: TimeInterval, finishedToday: Bool) {
        summary = value; syncedAt = uptime; online = true
        finished = finishedToday && !value.active
    }
    public mutating func disconnect() { online = false }
    public func seconds(at uptime: TimeInterval) -> Int {
        if finished { return 0 }
        // Freeze on a failed synchronization; never imply unconfirmed time was saved.
        let elapsed = summary.active && online ? min(90, max(0, uptime - syncedAt)) : 0
        return max(0, summary.workedSec) + Int(elapsed)
    }
    public static func format(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%02d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60)
    }
    public static func bounds(now: Date, calendar: Calendar = .current) -> (Date, Date) {
        let start = calendar.startOfDay(for: now)
        return (start, calendar.date(byAdding: .day, value: 1, to: start)!)
    }
}

public struct AgentPolicy: Decodable {
    public let trackingEnabled: Bool
    public let screenshotsEnabled: Bool
    public let collectApps: Bool?
    public let collectWindowTitles: Bool?
    public let collectIdle: Bool?
    public let screenshotInterval: Int?
    public let screenshotJitter: Int?
    public let blurScreenshots: Bool?
    public let retentionDays: Int?
    public let excludedApps: [String]?
    public func excludes(_ value: String) -> Bool {
        (excludedApps ?? []).filter { !$0.isEmpty }.contains { value.localizedCaseInsensitiveContains($0) }
    }
    public var captureDelay: TimeInterval {
        let base = Double(min(120, max(2, screenshotInterval ?? 10))) * 60
        let jitter = Double(min(50, max(0, screenshotJitter ?? 20))) / 100
        return base * Double.random(in: (1 - jitter)...(1 + jitter))
    }
}
