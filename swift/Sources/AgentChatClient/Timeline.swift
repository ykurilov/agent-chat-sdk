import Foundation

/// Messages and permission cards share one identity-safe timeline.
public enum ChatTimelineEntry: Identifiable, Sendable, Equatable {
    case message(ChatMessage), permission(ChatPermission)
    public var id: String { switch self { case .message(let m): "message:" + m.id; case .permission(let p): "permission:" + p.id } }
    public var sequence: Int? { switch self { case .message(let m): m.sequence; case .permission(let p): p.sequence } }
    public var createdAt: String? { switch self { case .message(let m): m.createdAt; case .permission(let p): p.createdAt } }
    private var group: Int {
        if sequence != nil { return 1 }
        // Optimistic local text has no server position yet and stays at the end.
        if case .message(let m) = self, m.isLocalEcho { return 2 }
        return 0
    }
    fileprivate static func ordered(_ entries: [Self]) -> [Self] {
        entries.enumerated().sorted { a, b in
            if a.element.group != b.element.group { return a.element.group < b.element.group }
            if let x = a.element.sequence, let y = b.element.sequence, x != y { return x < y }
            // Legacy entries have no recoverable original journal position. Use known time,
            // then stable snapshot order; never manufacture an old permission timestamp.
            let x = a.element.createdAt ?? "~", y = b.element.createdAt ?? "~"
            if x != y, a.element.group == 0 { return x < y }
            return a.offset < b.offset
        }.map(\.element)
    }
}
public extension ChatSnapshot {
    var timeline: [ChatTimelineEntry] { ChatTimelineEntry.ordered(messages.map(ChatTimelineEntry.message) + permissions.map(ChatTimelineEntry.permission)) }
}
