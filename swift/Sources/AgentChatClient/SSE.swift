import Foundation

/// SSE parser shared by tests and URLSession transport. A frame can contain multiple data lines.
public struct SSEParser: Sendable {
    public struct Frame: Sendable { public let event: String; public let id: String?; public let data: String; public init(event: String, id: String? = nil, data: String) { self.event = event; self.id = id; self.data = data } }
    private var event = "message"
    private var id: String?
    private var data: [String] = []
    private var size = 0
    public init() {}
    public mutating func consume(_ line: String) throws -> Frame? {
        if line.isEmpty {
            defer { event = "message"; id = nil; data = []; size = 0 }
            return data.isEmpty ? nil : Frame(event: event, id: id, data: data.joined(separator: "\n"))
        }
        if line.hasPrefix(":") { return nil }
        size += line.utf8.count
        if size > 2_000_000 { throw ChatClientError.invalidResponse }
        let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let value = parts.count > 1 ? String(parts[1]).replacingOccurrences(of: "^ ", with: "", options: .regularExpression) : ""
        switch parts.first {
        case "event": event = value
        case "id": if !value.contains("\0") { id = value }
        case "data": data.append(value)
        default: break
        }
        return nil
    }
}

/// Pure reducer: duplicate events are ignored, gaps require a new consistent snapshot.
public enum ChatReducer {
    public static func apply(_ event: ChatFeedEvent, to snapshot: inout ChatSnapshot) throws {
        guard event.version == 1 else { throw ChatClientError.unsupportedVersion }
        guard event.chatId == snapshot.conversation.id else { throw ChatClientError.invalidResponse }
        if event.seq <= snapshot.cursor { return }
        guard event.seq == snapshot.cursor + 1 else { throw ChatClientError.cursorReset }
        switch event.type {
        case "message":
            guard let message = event.message else { throw ChatClientError.invalidResponse }
            if let index = snapshot.messages.firstIndex(where: { $0.id == message.id }) {
                if message.revision > snapshot.messages[index].revision { snapshot.messages[index] = message }
            } else { snapshot.messages.append(message) }
        case "permission":
            guard let permission = event.permission else { throw ChatClientError.invalidResponse }
            if let index = snapshot.permissions.firstIndex(where: { $0.id == permission.id }) {
                if permission.revision > snapshot.permissions[index].revision { snapshot.permissions[index] = permission }
            } else { snapshot.permissions.append(permission) }
        case "model_state":
            guard let state = event.modelState else { throw ChatClientError.invalidResponse }
            snapshot.modelState = state
        case "status":
            guard let connection = event.connection, let turn = event.turn else { throw ChatClientError.invalidResponse }
            snapshot.conversation.connection = connection; snapshot.turn = turn
        default:
            // Unknown event semantics cannot be acknowledged by advancing the cursor silently.
            throw ChatClientError.unsupportedVersion
        }
        snapshot.cursor = event.seq
    }
}
