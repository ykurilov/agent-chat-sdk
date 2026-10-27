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
        var files: [ChatDraftAttachment]?
    }
    private struct ConversationList: Decodable { var version: Int; var conversations: [Conversation] }
    private struct SendBody: Encodable { var clientMessageId: String; var text: String; var attachmentIds: [String]? }
    private struct PermissionBody: Encodable { var commandId: String; var decision: PermissionDecision }
    private struct Receipt: Decodable { var version: Int; var messageId: String?; var accepted: Bool?; var delivery: String? }
    private struct StopBody: Encodable { var commandId: String }
    private let endpoint: URL
    private let cacheURL: URL
    private let credential: Credential
    private let stagingLimits: ChatAttachmentStagingLimits
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
    private var uploadTask: Task<Void, Never>?
    private var uploadProgress: [String: Double] = [:]
    private var progressCallbacks: [String: @Sendable (Double) -> Void] = [:]
    private struct ModelEnvelope: Decodable { var version: Int; var modelState: ChatExecutorModelState? }
    private struct ModelBody: Encodable { var commandId: String; var expectedRevision: String; var choice: ChatExecutorModelChoice }
    private var filesDirectory: URL { cacheURL.deletingLastPathComponent().appendingPathComponent(cacheURL.lastPathComponent + ".files", isDirectory: true) }

    public init(endpoint: URL, accountID: String, cacheURL: URL, session: URLSession = .shared, attachmentLimits: ChatAttachmentStagingLimits = .init(), credential: @escaping Credential) throws {
        guard ["https", "http"].contains(endpoint.scheme), endpoint.user == nil, endpoint.password == nil,
              endpoint.query == nil, endpoint.fragment == nil, !accountID.isEmpty else { throw ChatClientError.invalidEndpoint }
        self.stagingLimits = attachmentLimits
        self.endpoint = endpoint; self.cacheURL = cacheURL; self.session = session; self.credential = credential
        if FileManager.default.fileExists(atPath: cacheURL.path) {
            let existing = try JSONDecoder().decode(Cache.self, from: Data(contentsOf: cacheURL))
            guard existing.accountID == accountID, existing.endpoint == endpoint.absoluteString else { throw ChatClientError.cacheIdentityMismatch }
            cache = existing
        } else { cache = Cache(endpoint: endpoint.absoluteString, accountID: accountID) }
    }
    deinit { streamTask?.cancel(); retryTask?.cancel(); uploadTask?.cancel() }
    public func state() -> ChatClientState {
        var result = ChatClientState()
        result.conversations = cache.conversations.sorted { a, b in a.pinned != b.pinned ? a.pinned : a.updatedAt > b.updatedAt }
        result.selectedChatId = selected; result.network = network; result.error = error
        result.pending = cache.outbox
        result.attachments = (cache.files ?? []).filter { $0.chatId == selected && $0.messageId == nil }
        result.uploadProgress = uploadProgress
        if let id = selected, var snapshot = cache.snapshots[id] {
            for command in cache.outbox where command.chatId == id && command.kind == "message" && !snapshot.messages.contains(where: { $0.id == command.id }) {
                snapshot.messages.append(ChatMessage(id: command.id, role: "user", text: command.text ?? "", createdAt: command.createdAt ?? "", delivery: command.error == nil ? (command.delivery ?? "queued") : "refused", isLocalEcho: true, attachments: command.attachments))
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
        let oldFiles = cache.files ?? []
        cache = next
        for file in oldFiles where file.messageId != nil && !(next.files ?? []).contains(where: { $0.id == file.id }) { try? FileManager.default.removeItem(at: filesDirectory.appendingPathComponent(file.id)) }
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
        startUploads(); Task { await drainOutbox() }
    }
    public func openConversation(_ id: String) async {
        selected = id; generation = UUID(); streamTask?.cancel()
        disconnected = false; network = .connecting; error = nil; publish()
        let current = generation
        streamTask = Task { [weak self] in await self?.streamLoop(id: id, generation: current) }
    }
    public func disconnect() {
        uploadTask?.cancel()
        disconnected = true; lifecycle = UUID(); generation = UUID(); streamTask?.cancel(); streamTask = nil
        retryTask?.cancel(); retryTask = nil
        network = .disconnected; publish()
    }
    /// Returns only after the local outbox is on disk. Server delivery is independent of this call.
    @discardableResult public func send(_ text: String, chatId: String, attachmentIds: [String] = []) throws -> String {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachmentIds.isEmpty else { throw ChatClientError.invalidResponse }
        let id = "client:" + UUID().uuidString
        var next = cache
        let drafts = (cache.files ?? []).filter { $0.chatId == chatId && $0.messageId == nil }
        var attachments: [ChatAttachment] = [], localIds: [String] = []
        for attachmentId in attachmentIds {
            guard let file = drafts.first(where: { $0.uploaded?.id == attachmentId }), let ref = file.uploaded, !localIds.contains(file.id) else { throw ChatClientError.invalidResponse }
            attachments.append(ref); localIds.append(file.id)
        }
        var command = PendingCommand(id: id, chatId: chatId, kind: "message", text: text, createdAt: Date().ISO8601Format(), attachments: attachments.isEmpty ? nil : attachments)
        command.localAttachmentIds = localIds.isEmpty ? nil : localIds
        next.outbox.append(command)
        for index in (next.files ?? []).indices where localIds.contains(next.files![index].id) { next.files![index].messageId = id }
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
        do { var next = cache; for index in (next.files ?? []).indices { next.files![index].error = nil }; for index in next.outbox.indices {
            // Explicit retry grants one new upload recovery after a proven rejection, never an ambiguous receipt.
            if next.outbox[index].error == "request_refused", next.outbox[index].acknowledged != true { next.outbox[index].attachmentRetries = 0 }
            next.outbox[index].error = nil
        }; try commit(next); error = nil; startUploads(); await drainOutbox() }
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
                    if let ids = command.localAttachmentIds, ids.contains(where: { local in cache.files?.first(where: { $0.id == local })?.uploaded == nil }) { startUploads(); continue }
                    let data = try await post([command.chatId, "messages"], body: SendBody(clientMessageId: command.id, text: command.text ?? "", attachmentIds: command.attachments?.map(\.id)))
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
                if case ChatClientError.http(_, let kind) = error, ["attachment_not_found", "attachment_expired"].contains(kind), command.acknowledged != true, (command.attachmentRetries ?? 0) < 1, let ids = command.localAttachmentIds, !ids.isEmpty {
                    do {
                        var next = cache
                        for i in (next.files ?? []).indices where ids.contains(next.files![i].id) { next.files![i].uploaded = nil; next.files![i].error = nil }
                        if let i = next.outbox.firstIndex(where: { $0.id == command.id }) { next.outbox[i].attachmentRetries = 1 }
                        try commit(next); startUploads(); publish(); return
                    } catch { report(error); return }
                }
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
        var confirmedMessages = Set<String>()
        next.outbox.removeAll { command in
            guard command.chatId == snapshot.conversation.id else { return false }
            if command.kind == "message" {
                let matches = snapshot.messages.contains { $0.id == command.id && $0.role == "user" && $0.text == command.text && ($0.attachments ?? []).map(\.id) == (command.attachments ?? []).map(\.id) }
                if matches { confirmedMessages.insert(command.id) }; return matches
            }
            return snapshot.permissions.contains { $0.id == command.permissionId && ["responding", "resolved"].contains($0.status) }
        }
        next.files?.removeAll { file in file.chatId == snapshot.conversation.id && file.messageId.map { confirmedMessages.contains($0) } == true }
    }
    private func scheduleRetry() {
        guard retryTask == nil, !disconnected else { return }
        let delay = retryDelay; retryDelay = min(retryDelay * 2, 30)
        retryTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { return }
            await self?.retryTransport()
        }
    }
    private func retryTransport() async { retryTask = nil; if selected == nil { await connect() }; startUploads(); await drainOutbox() }
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
                startUploads(); Task { await drainOutbox() }
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
    public func attachmentSettings() async throws -> ChatAttachmentSettings { try await get(["attachments", "settings"]) }
    public func draftAttachments(chatId: String) -> [ChatDraftAttachment] { (cache.files ?? []).filter { $0.chatId == chatId && $0.messageId == nil } }
    public func attachmentLocalURL(id: String) -> URL? { cache.files?.contains(where: { $0.id == id }) == true ? filesDirectory.appendingPathComponent(id) : nil }
    /// Copies into account-scoped app storage before returning; upload/retry is independent of the picker lifetime.
    @discardableResult public func uploadAttachment(chatId: String, fileURL: URL, onProgress: (@Sendable (Double) -> Void)? = nil) throws -> String {
        guard fileURL.isFileURL else { throw ChatClientError.invalidResponse }
        let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size > 0 else { throw ChatClientError.invalidResponse }
        guard size <= stagingLimits.maxFileBytes else { throw ChatClientError.http(status: 413, kind: "too_large") }
        let files = cache.files ?? []
        guard files.filter({ $0.chatId == chatId && $0.messageId == nil }).count < stagingLimits.maxDraftFiles, files.count < stagingLimits.maxTotalFiles, files.reduce(0, { $0 + $1.size }) + size <= stagingLimits.maxTotalBytes else { throw ChatClientError.http(status: 429, kind: "too_many_unsent") }
        let id = UUID().uuidString
        try FileManager.default.createDirectory(at: filesDirectory, withIntermediateDirectories: true)
        let destination = filesDirectory.appendingPathComponent(id)
        try FileManager.default.copyItem(at: fileURL, to: destination)
        do {
            var next = cache; if next.files == nil { next.files = [] }
            next.files!.append(ChatDraftAttachment(id: id, chatId: chatId, name: fileURL.lastPathComponent, size: size))
            try commit(next)
        } catch { try? FileManager.default.removeItem(at: destination); throw error }
        progressCallbacks[id] = onProgress; publish(); startUploads(); return id
    }
    public func removeUnsentAttachment(_ id: String, chatId: String) async throws {
        guard let file = cache.files?.first(where: { $0.id == id && $0.chatId == chatId && $0.messageId == nil }) else { throw ChatClientError.invalidResponse }
        if let remote = file.uploaded {
            var req = try await request([chatId, "attachments", remote.id]); req.httpMethod = "DELETE"
            let (data, response) = try await session.data(for: req); try validate(response, data: data)
        }
        // A concurrent Send may have claimed the bytes while DELETE was in flight.
        guard cache.files?.contains(where: { $0.id == id && $0.chatId == chatId && $0.messageId == nil }) == true else { return }
        var next = cache; next.files?.removeAll { $0.id == id && $0.messageId == nil }; try commit(next)
        try? FileManager.default.removeItem(at: filesDirectory.appendingPathComponent(id)); progressCallbacks[id] = nil; uploadProgress[id] = nil; publish()
    }
    public func retryAttachment(_ id: String) throws { var next = cache; if let i = next.files?.firstIndex(where: { $0.id == id }) { next.files![i].error = nil }; try commit(next); startUploads(); publish() }
    public func downloadAttachment(chatId: String, attachment: ChatAttachment) async throws -> URL {
        guard UUID(uuidString: attachment.id) != nil else { throw ChatClientError.invalidResponse }
        let current = lifecycle
        let req = try await request([chatId, "attachments", attachment.id])
        let (temporary, response) = try await session.download(for: req); try validate(response)
        guard lifecycle == current, !disconnected else { try? FileManager.default.removeItem(at: temporary); throw CancellationError() }
        let directory = filesDirectory.appendingPathComponent("downloads", isDirectory: true).appendingPathComponent(attachment.id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let rawName = attachment.name.replacingOccurrences(of: "\\", with: "/").split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        let name = rawName.isEmpty || rawName == "." || rawName == ".." ? "file" : rawName
        let destination = directory.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: destination.path) { guard (try destination.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { throw ChatClientError.invalidResponse }; try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: temporary, to: destination); return destination
    }
    public func models(chatId: String) async throws -> ChatExecutorModelState? {
        let current = lifecycle
        let envelope: ModelEnvelope = try await get([chatId, "model"])
        guard lifecycle == current, !disconnected else { throw CancellationError() }
        guard envelope.version == 1 else { throw ChatClientError.unsupportedVersion }
        if var snapshot = cache.snapshots[chatId] { snapshot.modelState = envelope.modelState; var next = cache; next.snapshots[chatId] = snapshot; try commit(next); publish() }
        return envelope.modelState
    }
    public func setModel(chatId: String, choice: ChatExecutorModelChoice, expectedRevision: String, commandId: String = "model:" + UUID().uuidString) async throws {
        let current = lifecycle
        var req = try await request([chatId, "model"]); req.httpMethod = "PUT"; req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(ModelBody(commandId: commandId, expectedRevision: expectedRevision, choice: choice))
        do {
            let (data, response) = try await session.data(for: req); try validate(response, data: data)
            guard lifecycle == current, !disconnected else { throw CancellationError() }
            let result = try JSONDecoder().decode(ModelEnvelope.self, from: data)
            guard result.version == 1, let state = result.modelState else { throw ChatClientError.invalidResponse }
            if var snapshot = cache.snapshots[chatId] { snapshot.modelState = state; var next = cache; next.snapshots[chatId] = snapshot; try commit(next); publish() }
        } catch {
            if lifecycle == current, !disconnected { _ = try? await models(chatId: chatId) }
            throw error
        }
    }
    private func startUploads() {
        guard uploadTask == nil, !disconnected else { return }
        uploadTask = Task { [weak self] in await self?.drainUploads() }
    }
    private func didUpload(_ id: String, fraction: Double) { guard cache.files?.contains(where: { $0.id == id }) == true else { return }; uploadProgress[id] = fraction; progressCallbacks[id]?(fraction); publish() }
    private func drainUploads() async {
        let taskLifecycle = lifecycle
        let attempted = Set((cache.files ?? []).filter { $0.uploaded == nil && $0.error == nil }.map(\.id))
        defer {
            uploadTask = nil
            if !disconnected, (cache.files ?? []).contains(where: { $0.uploaded == nil && $0.error == nil && (lifecycle != taskLifecycle || !attempted.contains($0.id)) }) { startUploads() }
        }
        for file in cache.files ?? [] where file.uploaded == nil && file.error == nil {
            if disconnected || Task.isCancelled { return }
            let current = lifecycle
            do {
                let settings = try await attachmentSettings()
                guard file.size <= settings.maxFileBytes else { throw ChatClientError.http(status: 413, kind: "too_large") }
                guard (cache.files ?? []).filter({ $0.chatId == file.chatId && $0.messageId == nil }).count <= settings.maxFiles else { throw ChatClientError.http(status: 422, kind: "too_many") }
                let boundary = UUID().uuidString
                let body = filesDirectory.appendingPathComponent("upload-" + file.id)
                try multipart(file: file, boundary: boundary, to: body)
                defer { try? FileManager.default.removeItem(at: body) }
                var req = try await request([file.chatId, "attachments"]); req.httpMethod = "POST"
                req.setValue("multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")
                let delegate = AttachmentUploadProgress { [weak self] fraction in Task { await self?.didUpload(file.id, fraction: fraction) } }
                let (data, response) = try await session.upload(for: req, fromFile: body, delegate: delegate)
                try validate(response, data: data)
                guard current == lifecycle, !disconnected, !Task.isCancelled else { return }
                let remote = try JSONDecoder().decode(ChatAttachment.self, from: data)
                var next = cache
                guard let index = next.files?.firstIndex(where: { $0.id == file.id }) else { continue }
                next.files![index].uploaded = remote; next.files![index].error = nil
                if let messageId = next.files![index].messageId, let c = next.outbox.firstIndex(where: { $0.id == messageId }), let ids = next.outbox[c].localAttachmentIds {
                    let updated = ids.compactMap { local in next.files?.first(where: { $0.id == local })?.uploaded }
                    if updated.count == ids.count { next.outbox[c].attachments = updated }
                }
                try commit(next); didUpload(file.id, fraction: 1)
            } catch {
                if current != lifecycle || disconnected || Task.isCancelled { return }
                var next = cache
                if let i = next.files?.firstIndex(where: { $0.id == file.id }) { next.files![i].error = "Не удалось загрузить файл. Повторите загрузку" }
                try? commit(next); publish()
            }
        }
        await drainOutbox()
    }
    private func multipart(file: ChatDraftAttachment, boundary: String, to url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let output = try FileHandle(forWritingTo: url); defer { try? output.close() }
        let name = file.name.replacingOccurrences(of: "\\", with: "_").replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\r", with: "_").replacingOccurrences(of: "\n", with: "_")
        try output.write(contentsOf: Data(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + name + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").utf8))
        let input = try FileHandle(forReadingFrom: filesDirectory.appendingPathComponent(file.id)); defer { try? input.close() }
        while let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty { try output.write(contentsOf: chunk) }
        try output.write(contentsOf: Data(("\r\n--" + boundary + "--\r\n").utf8))
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
    private func validate(_ response: URLResponse, data: Data? = nil) throws {
        guard let http = response as? HTTPURLResponse else { throw ChatClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let object = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let failure = object?["error"] as? [String: Any]
            throw ChatClientError.http(status: http.statusCode, kind: failure?["code"] as? String ?? failure?["kind"] as? String ?? "request_failed")
        }
    }
    private func get<T: Decodable>(_ path: [String]) async throws -> T {
        let request = try await request(path)
        try Task.checkCancellation()
        guard !disconnected else { throw CancellationError() }
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func post<T: Encodable>(_ path: [String], body: T) async throws -> Data {
        var request = try await request(path)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        return data
    }
}

private final class AttachmentUploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let report: @Sendable (Double) -> Void
    init(_ report: @escaping @Sendable (Double) -> Void) { self.report = report }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        if totalBytesExpectedToSend > 0 { report(min(1, Double(totalBytesSent) / Double(totalBytesExpectedToSend))) }
    }
}
