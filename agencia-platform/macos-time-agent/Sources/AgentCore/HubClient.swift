import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HubError: LocalizedError {
    case status(Int)
    case invalidResponse
    public var errorDescription: String? {
        switch self {
        case .status(401), .status(403): return "La credencial no es válida o no tiene permiso. Revisa la vinculación en el CRM."
        case .status(409): return "La jornada ha cambiado en otro equipo. Actualiza su estado."
        case .status(let code): return "El CRM no ha confirmado la operación (\(code)). Vuelve a intentarlo."
        case .invalidResponse: return "El CRM ha devuelto una respuesta no válida."
        }
    }
}

public final class HubClient {
    private let token: String
    private let session: URLSession
    private let origin = "https://hub.negociovivo.app"
    public init(token: String, session: URLSession = .shared) { self.token = token; self.session = session }

    public func request(_ path: String, body: Data? = nil, contentType: String = "application/json") async throws -> Data {
        guard let url = URL(string: origin + path) else { throw HubError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw HubError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else { throw HubError.status(response.statusCode) }
        return data
    }
    public func policy() async throws -> AgentPolicy {
        try JSONDecoder().decode(AgentPolicy.self, from: await request("/api/v1/time-tracking/agent-config"))
    }
    public func day(now: Date = Date()) async throws -> DaySummary {
        let bounds = DayState.bounds(now: now)
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "dayStart", value: Self.iso(bounds.0)), URLQueryItem(name: "dayEnd", value: Self.iso(bounds.1))]
        return try JSONDecoder().decode(DaySummary.self, from: await request("/api/v1/time-tracking/me?" + (parts.percentEncodedQuery ?? "")))
    }
    public func action(_ action: String, deviceID: String) async throws {
        _ = try await request("/api/v1/time-tracking", body: JSONSerialization.data(withJSONObject: ["action": action, "deviceId": deviceID]))
    }
    public func activity(deviceID: String, since: Date, seconds: Int, app: String?, title: String?, idle: Bool) async throws {
        let entry: [String: Any] = ["bucketStart": Self.iso(since), "durationSec": seconds,
            "appName": app as Any? ?? NSNull(), "windowTitle": title as Any? ?? NSNull(), "idle": idle, "privateMode": false]
        _ = try await request("/api/v1/time-tracking/activity", body: JSONSerialization.data(withJSONObject: ["deviceId": deviceID, "entries": [entry]]))
    }
    public func upload(_ jpeg: Data, deviceID: String, policy: AgentPolicy, date: Date) async throws {
        let boundary = "NV-" + UUID().uuidString
        var data = Data()
        func add(_ text: String) { data.append(Data(text.utf8)) }
        let fields = ["deviceId": deviceID, "capturedAt": Self.iso(date), "retentionDays": String(policy.retentionDays ?? 30), "blurred": policy.blurScreenshots == true ? "true" : "false"]
        for (name, value) in fields {
            add("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"capture.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
        data.append(jpeg); add("\r\n--\(boundary)--\r\n")
        _ = try await request("/api/v1/time-tracking/screenshots", body: data, contentType: "multipart/form-data; boundary=\(boundary)")
    }
    public static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
}
