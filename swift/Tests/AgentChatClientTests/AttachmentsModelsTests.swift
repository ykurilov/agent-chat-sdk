import XCTest
@testable import AgentChatClient

@MainActor final class AttachmentsModelsTests: XCTestCase {
    func testDraftBytesSurviveRestartWithoutPickerAndAttachmentOnlyDelivery() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("cache.json"), source = directory.appendingPathComponent("archive.zip")
        try Data([80, 75, 3, 4]).write(to: source)
        let first = try AgentChatClient(endpoint: endpoint, accountID: "files", cacheURL: cache, credential: { "fixture-only" })
        let localId = try await first.uploadAttachment(chatId: "files-models", fileURL: source)
        try FileManager.default.removeItem(at: source)
        let restored = try AgentChatClient(endpoint: endpoint, accountID: "files", cacheURL: cache, credential: { "fixture-only" })
        let drafts = await restored.draftAttachments(chatId: "files-models"); XCTAssertEqual(drafts.first?.id, localId)
        await restored.connect(); await restored.openConversation("files-models")
        try await until { await restored.draftAttachments(chatId: "files-models").first?.uploaded != nil }
        let ready = await restored.draftAttachments(chatId: "files-models"); let file = try XCTUnwrap(ready.first?.uploaded)
        let message = try await restored.send("", chatId: "files-models", attachmentIds: [file.id])
        try await until { await restored.state().snapshot?.messages.contains(where: { $0.id == message && $0.attachments?.first?.id == file.id && $0.delivery == "sent" }) == true }
        let downloaded = try await restored.downloadAttachment(chatId: "files-models", attachment: file)
        XCTAssertEqual(try Data(contentsOf: downloaded), Data([80,75,3,4]))
        var hostile = file; hostile.name = ".."
        let safe = try await restored.downloadAttachment(chatId: "files-models", attachment: hostile)
        XCTAssertEqual(safe.lastPathComponent, "file"); XCTAssertTrue(FileManager.default.fileExists(atPath: cache.path))
        await restored.disconnect()
    }
    func testDeleteReceiptCannotEraseBytesCapturedByConcurrentSend() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("cache.json"), file = directory.appendingPathComponent("archive.zip")
        try Data([80, 75, 3, 4]).write(to: file)
        func control(_ path: String) async throws -> Data {
            var parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!; parts.path = "/fixture/" + path
            return try await URLSession.shared.data(from: parts.url!).0
        }
        let client = try AgentChatClient(endpoint: endpoint, accountID: "delete-race", cacheURL: cache, credential: { "fixture-only" })
        await client.connect(); await client.openConversation("files-models")
        let id = try await client.uploadAttachment(chatId: "files-models", fileURL: file)
        try await until { await client.draftAttachments(chatId: "files-models").first?.uploaded != nil }
        let drafts = await client.draftAttachments(chatId: "files-models"), ref = try XCTUnwrap(drafts.first?.uploaded)
        _ = try await control("hold-file-delete")
        let removing = Task { try await client.removeUnsentAttachment(id, chatId: "files-models") }
        try await until { (try? await control("file-delete-count")) == Data("1".utf8) }
        await client.disconnect()
        let message = try await client.send("Keep bytes", chatId: "files-models", attachmentIds: [ref.id])
        _ = try await control("release-file-delete"); try await removing.value
        let localURL = await client.attachmentLocalURL(id: id); let path = try XCTUnwrap(localURL)
        XCTAssertEqual(try Data(contentsOf: path), Data([80, 75, 3, 4]))
        let restored = try AgentChatClient(endpoint: endpoint, accountID: "delete-race", cacheURL: cache, credential: { "fixture-only" })
        await restored.connect(); await restored.openConversation("files-models")
        try await until { await restored.state().snapshot?.messages.contains(where: { $0.id == message && $0.delivery == "sent" }) == true }
        await restored.disconnect()
    }
    func testManualRetryRestoresExpiredReplacementWithoutLosingBytes() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = directory.appendingPathComponent("cache.json"), file = directory.appendingPathComponent("archive.zip")
        try Data([80, 75, 3, 4]).write(to: file)
        let client = try AgentChatClient(endpoint: endpoint, accountID: "expired-replacement", cacheURL: cache, credential: { "fixture-only" })
        await client.connect(); await client.openConversation("files-models")
        _ = try await client.uploadAttachment(chatId: "files-models", fileURL: file)
        try await until { await client.draftAttachments(chatId: "files-models").first?.uploaded != nil }
        let drafts = await client.draftAttachments(chatId: "files-models"), ref = try XCTUnwrap(drafts.first?.uploaded)
        var parts = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!; parts.path = "/fixture/reject-files-twice"
        _ = try await URLSession.shared.data(from: parts.url!)
        let id = try await client.send("Retry after second expiry", chatId: "files-models", attachmentIds: [ref.id])
        try await until { await client.state().pending.contains(where: { $0.id == id && $0.error == "request_refused" }) }
        await client.disconnect()
        let restored = try AgentChatClient(endpoint: endpoint, accountID: "expired-replacement", cacheURL: cache, credential: { "fixture-only" })
        await restored.connect(); await restored.openConversation("files-models"); await restored.retryPending()
        try await until { await restored.state().snapshot?.messages.contains(where: { $0.id == id && $0.delivery == "sent" }) == true }
        await restored.disconnect()
    }
    func testModelStateSSEAndConfirmedSelection() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("cache.json")
        defer { try? FileManager.default.removeItem(at: cache.deletingLastPathComponent()) }
        let client = try AgentChatClient(endpoint: endpoint, accountID: "models", cacheURL: cache, credential: { "fixture-only" })
        await client.connect(); await client.openConversation("files-models")
        try await until { await client.state().snapshot?.modelState != nil }
        let model = try await client.models(chatId: "files-models"); let current = try XCTUnwrap(model)
        try await client.setModel(chatId: "files-models", choice: ChatExecutorModelChoice(id: "model-b"), expectedRevision: current.revision)
        let after = await client.state().snapshot?.modelState; XCTAssertEqual(after?.selected.id, "model-b"); XCTAssertEqual(after?.selected.reasoning, "high")
        await client.disconnect()
    }
    func testStagingLimitRejectsBeforeCopyingBytes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("file.bin"); try Data([1, 2, 3, 4]).write(to: file)
        let client = try AgentChatClient(endpoint: URL(string: "http://localhost/api/conversations")!, accountID: "a", cacheURL: directory.appendingPathComponent("cache.json"), attachmentLimits: .init(maxFileBytes: 3), credential: { "test" })
        do { _ = try await client.uploadAttachment(chatId: "c", fileURL: file); XCTFail("Oversized copy accepted") }
        catch ChatClientError.http(let status, let kind) { XCTAssertEqual(status, 413); XCTAssertEqual(kind, "too_large") }
        let drafts = await client.draftAttachments(chatId: "c"); XCTAssertTrue(drafts.isEmpty)
    }
    func testReducerPersistsFilesAndModelStateWithCursor() throws {
        let attachment = ChatAttachment(id: UUID().uuidString, name: "data.zip", mediaType: "application/zip", size: 4, kind: "file")
        var snapshot = ChatSnapshot(conversation: Conversation(id: "c", title: "C", execution: .init(kind: "external")))
        try ChatReducer.apply(ChatFeedEvent(seq: 1, chatId: "c", type: "message", message: ChatMessage(id: "u", role: "user", text: "", createdAt: "", attachments: [attachment])), to: &snapshot)
        let models = ChatExecutorModelState(revision: "a", models: [.init(id: "a", label: "A")], selected: .init(id: "a"))
        try ChatReducer.apply(ChatFeedEvent(seq: 2, chatId: "c", type: "model_state", modelState: models), to: &snapshot)
        let restored = try JSONDecoder().decode(ChatSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(restored.messages.first?.attachments, [attachment]); XCTAssertEqual(restored.modelState, models); XCTAssertEqual(restored.cursor, 2)
    }
    private func until(_ condition: () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline { if await condition() { return }; try await Task.sleep(for: .milliseconds(30)) }
        XCTFail("Files/models condition timed out"); throw ChatClientError.invalidResponse
    }
}
