import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One instance per authenticated account. Credentials are supplied by the application, never persisted here.
public actor AgentChatClient {
    public typealias Credential = @Sendable () async throws -> String
    private struct Cache: Codable {
        var endpoint: String
        var accountID: String
        var conversations: [Conversation] = []
        var snapshots: [String: ChatSnapshot] = [:]
        var outbox: [PendingCommand] = []
        var drafts: [String: String] = [:]
    }
    private struct ConversationList: Decodable { var version: Int; var conversations: [Conversation] }
    private struct SendBody: Encodable { var clientMessageId: String; var text: String }
    private struct PermissionBody: Encodable { var commandId: String; var decision: PermissionDecision }
    private struct Receipt: Decodable { var version: Int; var messageId: String?; var accepted: Bool?; var delivery: String? }
    private struct StopBody: Encodable { var commandId: String }
    private let endpoint: URL
    private let cacheURL: URL
    private let credential: Credential
    private let session: URLSession
    private var cache: Cache
    private var selected: String?
    private var network: NetworkState = .disconnected
    private var error: String?
    private var listeners: [UUID: AsyncStream<ChatClientState>.Continuation] = [:]
    private var generation = UUID()
    private var lifecycle = UUID()
    private var streamTask: Task<Void, Never>?
    private var sending = false
    private var retryTask: Task<Void, Never>?
    private var retryDelay: UInt64 = 1
    private var disconnected = true

    public init(endpoint: URL, accountID: String, cacheURL: URL, session: URLSession = .shared, credential: @escaping Credential) throws {
        guard ["https", "http"].contains(endpoint.scheme), endpoint.user == nil, endpoint.password == nil,
              endpoint.query == nil, endpoint.fragment == nil, !accountID.isEmpty else { throw ChatClientError.invalidEndpoint }
        self.endpoint = endpoint; self.cacheURL = cacheURL; self.session = session; self.credential = credential
        if FileManager.default.fileExists(atPath: cacheURL.path) {
            let existing = try JSONDecoder().decode(Cache.self, from: Data(contentsOf: cacheURL))
            guard existing.accountID == accountID, existing.endpoint == endpoint.absoluteString else { throw ChatClientError.cacheIdentityMismatch }
            cache = existing
        } else { cache = Cache(endpoint: endpoint.absoluteString, accountID: accountID) }
    }
    deinit { streamTask?.cancel(); retryTask?.cancel() }
    public func state() -> ChatClientState {
        var result = ChatClientState()
        result.conversations = cache.conversations.sorted { a, b in a.pinned != b.pinned ? a.pinned : a.updatedAt > b.updatedAt }
        result.selectedChatId = selected; result.network = network; result.error = error
        result.pending = cache.outbox
        if let id = selected, var snapshot = cache.snapshots[id] {
            for command in cache.outbox where command.chatId == id && command.kind == "message" && !snapshot.messages.contains(where: { $0.id == command.id }) {
                snapshot.messages.append(ChatMessage(id: command.id, role: "user", text: command.text ?? "", createdAt: command.createdAt ?? "", delivery: command.error == nil ? (command.delivery ?? "queued") : "refused", isLocalEcho: true))
            }
            for command in cache.outbox where command.chatId == id && command.kind == "permission" && command.error == nil {
                if let index = snapshot.permissions.firstIndex(where: { $0.id == command.permissionId && $0.status == "open" }) { snapshot.permissions[index].status = "responding" }
            }
            result.snapshot = snapshot
        }
        return result
    }
    public func updates() -> AsyncStream<ChatClientState> {
        let id = UUID()
        let pair = AsyncStream<ChatClientState>.makeStream(bufferingPolicy: .bufferingNewest(1))
        listeners[id] = pair.continuation
        pair.continuation.yield(state())
        pair.continuation.onTermination = { [weak self] _ in Task { await self?.removeListener(id) } }
        return pair.stream
    }
    private func removeListener(_ id: UUID) { listeners.removeValue(forKey: id) }
    private func publish() { let value = state(); for listener in listeners.values { listener.yield(value) } }
    private func commit(_ next: Cache) throws {
        let data = try JSONEncoder().encode(next)
        try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: cacheURL, options: .atomic)
        cache = next
    }
    public func draft(chatId: String) -> String { cache.drafts[chatId] ?? "" }
    public func setDraft(_ text: String, chatId: String) throws {
        var next = cache; next.drafts[chatId] = text; try commit(next)
    }
    public func connect() async {
        lifecycle = UUID(); let currentLifecycle = lifecycle
        disconnected = false
        // Cached conversations remain usable while the server is unavailable.
        if selected == nil, let cached = state().conversations.first?.id { await openConversation(cached) }
        do {
            let value: ConversationList = try await get([])
            guard lifecycle == currentLifecycle, !disconnected else { return }
            guard value.version == 1 else { throw ChatClientError.unsupportedVersion }
            var next = cache; next.conversations = value.conversations; try commit(next)
            let id = selected ?? state().conversations.first?.id
            if let id { await openConversation(id) } else { network = .connected; publish() }
        } catch { guard lifecycle == currentLifecycle, !disconnected else { return }; report(error); if network != .unauthorized { scheduleRetry() } }
        guard lifecycle == currentLifecycle, !disconnected else { return }
        Task { await drainOutbox() }
    }
    public func openConversation(_ id: String) async {
        selected = id; generation = UUID(); streamTask?.cancel()
        disconnected = false; network = .connecting; error = nil; publish()
        let current = generation
        streamTask = Task { [weak self] in await self?.streamLoop(id: id, generation: current) }
    }
    public func disconnect() {
        disconnected = true; lifecycle = UUID(); generation = UUID(); streamTask?.cancel(); streamTask = nil
        retryTask?.cancel(); retryTask = nil
        network = .disconnected; publish()
    }
    /// Returns only after the local outbox is on disk. Server delivery is independent of this call.
    @discardableResult public func send(_ text: String, chatId: String) throws -> String {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ChatClientError.invalidResponse }
        let id = "client:" + UUID().uuidString
        var next = cache
        next.outbox.append(PendingCommand(id: id, chatId: chatId, kind: "message", text: text, createdAt: Date().ISO8601Format()))
        next.drafts[chatId] = ""
        try commit(next); publish()
        Task { await drainOutbox() }
        return id
    }
    @discardableResult public func answer(_ permissionId: String, chatId: String, decision: PermissionDecision) throws -> String {
        let id = "decision:" + UUID().uuidString
        var next = cache
        next.outbox.append(PendingCommand(id: id, chatId: chatId, kind: "permission", permissionId: permissionId, decision: decision))
        try commit(next); publish(); Task { await drainOutbox() }; return id
    }
    public func stop(chatId: String) async throws {
        // Never queue an offline Stop that might later cancel a different turn.
        _ = try await post([chatId, "stop"], body: StopBody(commandId: "stop:" + UUID().uuidString))
    }
    public func retryPending() async {
        do { var next = cache; for index in next.outbox.indices { next.outbox[index].error = nil }; try commit(next); error = nil; await drainOutbox() }
        catch { report(error) }
    }
    private func drainOutbox() async {
        guard !sending, !disconnected else { return }
        sending = true
        defer { sending = false }
        for command in cache.outbox where command.error == nil && command.acknowledged != true {
            if disconnected { return }
            do {
                var acceptedDelivery: String?
                if command.kind == "message" {
                    let data = try await post([command.chatId, "messages"], body: SendBody(clientMessageId: command.id, text: command.text ?? ""))
                    let receipt = try JSONDecoder().decode(Receipt.self, from: data)
                    guard receipt.version == 1, receipt.messageId == command.id, let delivery = receipt.delivery, ["queued", "sending", "unknown", "sent"].contains(delivery) else { throw ChatClientError.invalidResponse }
                    acceptedDelivery = delivery
                } else if let permission = command.permissionId, let decision = command.decision {
                    let data = try await post([command.chatId, "permissions", permission], body: PermissionBody(commandId: command.id, decision: decision))
                    let receipt = try JSONDecoder().decode(Receipt.self, from: data)
                    guard receipt.version == 1, receipt.accepted == true else { throw ChatClientError.invalidResponse }
                }
                var next = cache
                if let index = next.outbox.firstIndex(where: { $0.id == command.id }) {
                    next.outbox[index].acknowledged = true; next.outbox[index].delivery = acceptedDelivery
                }
                if let snapshot = next.snapshots[command.chatId] { removeConfirmed(from: &next, snapshot: snapshot) }
                try commit(next); retryDelay = 1; publish()
            } catch {
                if !cache.outbox.contains(where: { $0.id == command.id }) { continue }
                if case ChatClientError.http(let status, _) = error, (400..<500).contains(status), status != 429, status != 401 {
                    do { var next = cache; if let index = next.outbox.firstIndex(where: { $0.id == command.id }) { next.outbox[index].error = "request_refused" }; try commit(next) } catch { report(error) }
                }
                report(error)
                if network != .unauthorized { scheduleRetry() }
                return
            }
        }
        if cache.outbox.contains(where: { $0.error == nil && $0.acknowledged != true }) { scheduleRetry() }
    }
    /// Clear local text only in the same disk write that stores its canonical projection.
    private func removeConfirmed(from next: inout Cache, snapshot: ChatSnapshot) {
        next.outbox.removeAll { command in
            guard command.chatId == snapshot.conversation.id else { return false }
            if command.kind == "message" { return snapshot.messages.contains { $0.id == command.id && $0.role == "user" && $0.text == command.text } }
            return snapshot.permissions.contains { $0.id == command.permissionId && ["responding", "resolved"].contains($0.status) }
        }
    }
    private func scheduleRetry() {
        guard retryTask == nil, !disconnected else { return }
        let delay = retryDelay; retryDelay = min(retryDelay * 2, 30)
        retryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { return }
            await self?.retryTransport()
        }
    }
    private func retryTransport() async { retryTask = nil; if selected == nil { await connect() }; await drainOutbox() }
    private func streamLoop(id: String, generation current: UUID) async {
        var reload = true, delay: UInt64 = 1
        while !Task.isCancelled, generation == current, !disconnected {
            do {
                if reload {
                    let snapshot: ChatSnapshot = try await get([id])
                    guard snapshot.version == 1, snapshot.conversation.id == id else { throw ChatClientError.unsupportedVersion }
                    guard generation == current else { return }
                    var next = cache; next.snapshots[id] = snapshot; removeConfirmed(from: &next, snapshot: snapshot); try commit(next); reload = false; publish()
                }
                guard let snapshot = cache.snapshots[id] else { throw ChatClientError.invalidResponse }
                var request = try await request([id, "events"], after: snapshot.cursor)
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                try Task.checkCancellation()
                guard generation == current, !disconnected else { return }
                let (bytes, response) = try await session.bytes(for: request)
                try validate(response)
                guard generation == current else { return }
                network = .connected; error = nil; publish(); delay = 1
                Task { await drainOutbox() }
                var parser = SSEParser()
                // Parse bytes ourselves: preserve blank SSE frame delimiters across arbitrary chunks.
                var lineBytes: [UInt8] = []
                for try await byte in bytes {
                    guard byte == 10 else {
                        lineBytes.append(byte)
                        if lineBytes.count > 2_000_000 { throw ChatClientError.invalidResponse }
                        continue
                    }
                    if lineBytes.last == 13 { lineBytes.removeLast() }
                    guard let line = String(bytes: lineBytes, encoding: .utf8) else { throw ChatClientError.invalidResponse }
                    lineBytes.removeAll(keepingCapacity: true)
                    try Task.checkCancellation()
                    guard generation == current else { return }
                    guard let frame = try parser.consume(line) else { continue }
                    if frame.event == "reset" { throw ChatClientError.cursorReset }
                    guard frame.event == "change" else { throw ChatClientError.unsupportedVersion }
                    let event = try JSONDecoder().decode(ChatFeedEvent.self, from: Data(frame.data.utf8))
                    guard var nextSnapshot = cache.snapshots[id] else { throw ChatClientError.cursorReset }
                    try ChatReducer.apply(event, to: &nextSnapshot)
                    var next = cache; next.snapshots[id] = nextSnapshot
                    removeConfirmed(from: &next, snapshot: nextSnapshot)
                    try commit(next); publish()
                }
            } catch is CancellationError { return }
            catch ChatClientError.cursorReset { guard generation == current, !disconnected else { return }; reload = true; continue }
            catch ChatClientError.http(let code, _) where code == 409 { guard generation == current, !disconnected else { return }; reload = true; continue }
            catch ChatClientError.http(let code, _) where code == 401 { guard generation == current, !disconnected else { return }; network = .unauthorized; publish(); return }
            catch ChatClientError.unsupportedVersion { guard generation == current, !disconnected else { return }; error = "unsupported_protocol"; network = .disconnected; publish(); return }
            catch { guard generation == current, !disconnected else { return }; report(error) }
            guard generation == current, !disconnected else { return }
            network = .reconnecting; publish()
            do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { return }
            delay = min(delay * 2, 30)
        }
    }
    private func report(_ failure: any Error) {
        error = "connection_or_request_failed"
        if case ChatClientError.http(let code, _) = failure, code == 401 { network = .unauthorized }
        else if !disconnected { network = .reconnecting }
        publish()
    }
    private func request(_ path: [String], after: Int? = nil) async throws -> URLRequest {
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        let suffix = path.map { $0.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "/")
        components.percentEncodedPath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedPath = "/" + [components.percentEncodedPath, suffix].filter { !$0.isEmpty }.joined(separator: "/")
        if let after { components.queryItems = [URLQueryItem(name: "after", value: String(after))] }
        guard let url = components.url else { throw ChatClientError.invalidEndpoint }
        let token = try await credential()
        try Task.checkCancellation()
        guard !disconnected else { throw CancellationError() }
        guard !token.isEmpty else { throw ChatClientError.http(status: 401, kind: "unauthorized") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35)
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        return request
    }
    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ChatClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw ChatClientError.http(status: http.statusCode, kind: "request_failed") }
    }
    private func get<T: Decodable>(_ path: [String]) async throws -> T {
        let request = try await request(path)
        try Task.checkCancellation()
        guard !disconnected else { throw CancellationError() }
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func post<T: Encodable>(_ path: [String], body: T) async throws -> Data {
        var request = try await request(path)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return data
    }
}
