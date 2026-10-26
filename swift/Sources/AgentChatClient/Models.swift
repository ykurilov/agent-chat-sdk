import Foundation

public enum JSONValue: Codable, Sendable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
    public subscript(_ key: String) -> JSONValue? { if case .object(let v) = self { v[key] } else { nil } }
    public var string: String? { if case .string(let v) = self { v } else { nil } }
    public var array: [JSONValue]? { if case .array(let v) = self { v } else { nil } }
}
public struct ModelChoice: Codable, Sendable, Equatable {
    public var modelId: String
    public var providerId: String
    public var reasoning: String?
    public init(modelId: String, providerId: String, reasoning: String? = nil) { self.modelId = modelId; self.providerId = providerId; self.reasoning = reasoning }
}
public struct Conversation: Codable, Sendable, Equatable, Identifiable {
    public struct Execution: Codable, Sendable, Equatable { public var kind: String; public init(kind: String) { self.kind = kind } }
    public var id: String
    public var title: String
    public var pinned: Bool
    public var execution: Execution
    public var modelChoice: ModelChoice?
    public var updatedAt: String
    public var connection: String
    public init(id: String, title: String, pinned: Bool = false, execution: Execution, modelChoice: ModelChoice? = nil, updatedAt: String = "", connection: String = "offline") {
        self.id = id; self.title = title; self.pinned = pinned; self.execution = execution; self.modelChoice = modelChoice; self.updatedAt = updatedAt; self.connection = connection
    }
}
public struct ChatMessage: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var role: String
    public var text: String
    public var createdAt: String
    public var revision: Int
    public var delivery: String?
    public var status: String
    public var sequence: Int?
    /// Transient presentation provenance; never decoded from the server or persisted as canonical data.
    public internal(set) var isLocalEcho = false
    private enum CodingKeys: String, CodingKey { case id, role, text, createdAt, revision, delivery, status, sequence }
    public init(id: String, role: String, text: String, createdAt: String, revision: Int = 0, delivery: String? = nil, status: String = "complete", sequence: Int? = nil, isLocalEcho: Bool = false) {
        self.id = id; self.role = role; self.text = text; self.createdAt = createdAt
        self.revision = revision; self.delivery = delivery; self.status = status; self.sequence = sequence; self.isLocalEcho = isLocalEcho
    }
}
public struct ChatPermission: Codable, Sendable, Equatable, Identifiable {
    public struct Action: Codable, Sendable, Equatable, Identifiable {
        public var id: String; public var label: String; public var behavior: String
        public init(id: String, label: String, behavior: String) { self.id = id; self.label = label; self.behavior = behavior }
    }
    public var id: String
    public var name: String
    public var kind: String
    public var title: String?
    public var description: String?
    public var input: [String: JSONValue]?
    public var actions: [Action]?
    public var status: String
    public var revision: Int
    public var decision: PermissionDecision?
    public var resolution: PermissionResolution?
    public var createdAt: String?
    public var sequence: Int?
    public init(id: String, name: String, kind: String, title: String? = nil, description: String? = nil, input: [String: JSONValue]? = nil, actions: [Action]? = nil, status: String = "open", revision: Int = 0, decision: PermissionDecision? = nil, resolution: PermissionResolution? = nil, createdAt: String? = nil, sequence: Int? = nil) {
        self.id = id; self.name = name; self.kind = kind; self.title = title; self.description = description; self.input = input; self.actions = actions; self.status = status; self.revision = revision
        self.decision = decision; self.resolution = resolution; self.createdAt = createdAt; self.sequence = sequence
    }
}
/// What the external source actually reported, distinct from an SDK-submitted decision intent.
public struct PermissionResolution: Codable, Sendable, Equatable {
    public var behavior: String
    public var selectedActionId: String?
    public var updatedInput: [String: JSONValue]?
    public var message: String?
    public init(behavior: String, selectedActionId: String? = nil, updatedInput: [String: JSONValue]? = nil, message: String? = nil) {
        self.behavior = behavior; self.selectedActionId = selectedActionId; self.updatedInput = updatedInput; self.message = message
    }
}
public struct ChatTurn: Codable, Sendable, Equatable {
    public var status: String
    public var generation: Int
    public var stopRequested: Bool?
    public var error: String?
    public init(status: String = "idle", generation: Int = 0, stopRequested: Bool? = nil, error: String? = nil) { self.status = status; self.generation = generation; self.stopRequested = stopRequested; self.error = error }
}
public struct ChatSnapshot: Codable, Sendable, Equatable {
    public var version: Int
    public var conversation: Conversation
    public var cursor: Int
    public var messages: [ChatMessage]
    public var permissions: [ChatPermission]
    public var turn: ChatTurn
    public init(version: Int = 1, conversation: Conversation, cursor: Int = 0, messages: [ChatMessage] = [], permissions: [ChatPermission] = [], turn: ChatTurn = ChatTurn()) {
        self.version = version; self.conversation = conversation; self.cursor = cursor; self.messages = messages; self.permissions = permissions; self.turn = turn
    }
}
public struct PermissionDecision: Codable, Sendable, Equatable {
    public var actionId: String?
    public var behavior: String?
    public var answers: [String: String]?
    public init(actionId: String? = nil, behavior: String? = nil, answers: [String: String]? = nil) {
        self.actionId = actionId; self.behavior = behavior; self.answers = answers
    }
}
public struct ChatFeedEvent: Codable, Sendable {
    public var version: Int
    public var seq: Int
    public var chatId: String
    public var type: String
    public var message: ChatMessage?
    public var permission: ChatPermission?
    public var connection: String?
    public var turn: ChatTurn?
    public init(version: Int = 1, seq: Int, chatId: String, type: String, message: ChatMessage? = nil, permission: ChatPermission? = nil, connection: String? = nil, turn: ChatTurn? = nil) {
        self.version = version; self.seq = seq; self.chatId = chatId; self.type = type; self.message = message; self.permission = permission; self.connection = connection; self.turn = turn
    }
}
public enum NetworkState: String, Codable, Sendable { case disconnected, connecting, connected, reconnecting, unauthorized }
public struct PendingCommand: Codable, Sendable, Equatable, Identifiable {
    public var id: String
    public var chatId: String
    public var kind: String
    public var text: String?
    public var permissionId: String?
    public var decision: PermissionDecision?
    public var error: String?
    public var acknowledged: Bool?
    public var delivery: String?
    public var createdAt: String?
    public init(id: String, chatId: String, kind: String, text: String? = nil, permissionId: String? = nil, decision: PermissionDecision? = nil, error: String? = nil, acknowledged: Bool? = nil, delivery: String? = nil, createdAt: String? = nil) {
        self.id = id; self.chatId = chatId; self.kind = kind; self.text = text; self.permissionId = permissionId; self.decision = decision; self.error = error; self.acknowledged = acknowledged; self.delivery = delivery; self.createdAt = createdAt
    }
}
public struct ChatClientState: Sendable {
    public init() {}
    public var conversations: [Conversation] = []
    public var selectedChatId: String?
    public var snapshot: ChatSnapshot?
    public var network: NetworkState = .disconnected
    public var pending: [PendingCommand] = []
    public var error: String?
}
public enum ChatClientError: Error, Sendable {
    case invalidEndpoint, cacheIdentityMismatch, unsupportedVersion, invalidResponse, cursorReset
    case http(status: Int, kind: String)
}
