import AppKit
import ScreenCaptureKit
import CoreImage
import AgentCore

enum ScreenCapture {
    static var permitted: Bool { CGPreflightScreenCaptureAccess() }
    static var idle: Bool { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null) > 300 }
    static var unlocked: Bool {
        guard let info = CGSessionCopyCurrentDictionary() as? [String: Any],
              info[kCGSessionOnConsoleKey] as? Bool == true else { return false }
        return info["CGSSessionScreenIsLocked"] as? Bool != true
    }
    static func requestPermission() { _ = CGRequestScreenCaptureAccess() }

    static func images(policy: AgentPolicy) async throws -> [Data] {
        guard permitted, unlocked, !idle else { return [] }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        // Fail closed if any visible app/window is excluded, including other displays.
        guard !content.windows.contains(where: {
            policy.excludes($0.owningApplication?.applicationName ?? "") ||
            policy.excludes($0.owningApplication?.bundleIdentifier ?? "") || policy.excludes($0.title ?? "")
        }) else { return [] }
        var result: [Data] = []
        for display in content.displays {
            guard unlocked, !idle else { return [] }
            let configuration = SCStreamConfiguration()
            let scale = min(1, 1600 / Double(max(1, display.width)))
            configuration.width = max(1, Int(Double(display.width) * scale))
            configuration.height = max(1, Int(Double(display.height) * scale))
            configuration.showsCursor = false
            configuration.capturesAudio = false
            let image = try await SCScreenshotManager.captureImage(
                contentFilter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration)
            let source = CIImage(cgImage: image)
            let filtered = policy.blurScreenshots == true
                ? source.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 24]).cropped(to: source.extent)
                : source
            guard let processed = CIContext().createCGImage(filtered, from: source.extent),
                  let jpeg = NSBitmapImageRep(cgImage: processed).representation(using: .jpeg, properties: [.compressionFactor: 0.65]),
                  jpeg.count <= 8 * 1024 * 1024 else { throw HubError.invalidResponse }
            result.append(jpeg)
        }
        return result
    }
    static func windowTitle(policy: AgentPolicy) -> String? {
        guard policy.collectWindowTitles == true, permitted,
              let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        return windows.first { ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0 }
            .flatMap { $0[kCGWindowName as String] as? String }.map { String($0.prefix(300)) }
    }
}
