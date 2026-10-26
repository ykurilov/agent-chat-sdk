import XCTest
import AgentChatClient

final class PublicModelsTests: XCTestCase {
    func testPublicConstructionAndResolutionRoundTrip() throws {
        let resolution = PermissionResolution(behavior: "allow", selectedActionId: "yes", updatedInput: ["answers": .object(["Куда?": .string("Домой")])])
        let permission = ChatPermission(id: "p", name: "AskUserQuestion", kind: "question", status: "resolved", revision: 2, decision: PermissionDecision(answers: ["Куда?": "Домой"]), resolution: resolution, createdAt: "2026-10-26T00:00:00Z", sequence: 2)
        let snapshot = ChatSnapshot(conversation: Conversation(id: "main", title: "Главный", execution: .init(kind: "external")), cursor: 2, messages: [ChatMessage(id: "m", role: "assistant", text: "Ответ", createdAt: "2026-10-26T00:00:00Z", sequence: 1)], permissions: [permission])
        let restored = try JSONDecoder().decode(ChatSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(restored, snapshot)
        XCTAssertEqual(restored.permissions[0].resolution?.updatedInput?["answers"]?["Куда?"]?.string, "Домой")
        XCTAssertEqual(restored.permissions[0].decision?.answers?["Куда?"], "Домой")
    }
    func testLegacySnapshotHasNoInventedResolutionOrPosition() throws {
        let permission = try JSONDecoder().decode(ChatPermission.self, from: Data(#"{"id":"p","name":"Read","kind":"tool","status":"resolved","revision":1}"#.utf8))
        XCTAssertNil(permission.resolution); XCTAssertNil(permission.createdAt); XCTAssertNil(permission.sequence)
    }
}

extension PublicModelsTests {
    func testTimelinePlacesPermissionBetweenMessagesAndLocalTextLast() {
        let snapshot = ChatSnapshot(conversation: Conversation(id: "c", title: "Chat", execution: .init(kind: "external")), messages: [
            ChatMessage(id: "a", role: "assistant", text: "a", createdAt: "later", sequence: 1),
            ChatMessage(id: "b", role: "assistant", text: "b", createdAt: "earlier", sequence: 3),
            ChatMessage(id: "local", role: "user", text: "local", createdAt: "now", delivery: "queued", isLocalEcho: true)
        ], permissions: [ChatPermission(id: "p", name: "Read", kind: "tool", sequence: 2)])
        XCTAssertEqual(snapshot.timeline.map(\.id), ["message:a", "permission:p", "message:b", "message:local"])
    }
}

extension PublicModelsTests {
    func testLegacyUnsentCanonicalMessageStaysBeforeModernSequence() {
        let snapshot = ChatSnapshot(conversation: Conversation(id: "c", title: "Chat", execution: .init(kind: "external")), messages: [
            ChatMessage(id: "legacy", role: "user", text: "old", createdAt: "2026-10-25T00:00:00Z", revision: 3, delivery: "unknown"),
            ChatMessage(id: "modern", role: "assistant", text: "new", createdAt: "2026-10-26T00:00:00Z", sequence: 5)
        ], permissions: [ChatPermission(id: "p", name: "Read", kind: "tool", sequence: 6)])
        XCTAssertEqual(snapshot.timeline.map(\.id), ["message:legacy", "message:modern", "permission:p"])
    }
}

extension PublicModelsTests {
    func testAcknowledgedSentOverlayIsLocalAndSortedAfterCanonicalEntries() async throws {
        let conversation = Conversation(id: "c", title: "Chat", execution: .init(kind: "external"))
        let snapshot = ChatSnapshot(conversation: conversation, cursor: 2, messages: [ChatMessage(id: "a", role: "assistant", text: "saved", createdAt: "2026-10-26T00:00:00Z", sequence: 1)], permissions: [ChatPermission(id: "p", name: "Read", kind: "tool", sequence: 2)])
        struct SavedCache: Encodable {
            let endpoint: String, accountID: String
            let conversations: [Conversation], snapshots: [String: ChatSnapshot], outbox: [PendingCommand], drafts: [String: String]
        }
        let endpoint = URL(string: "http://127.0.0.1:9/api/conversations")!
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        let cache = SavedCache(endpoint: endpoint.absoluteString, accountID: "owner", conversations: [conversation], snapshots: ["c": snapshot], outbox: [PendingCommand(id: "local", chatId: "c", kind: "message", text: "accepted", acknowledged: true, delivery: "sent")], drafts: [:])
        try JSONEncoder().encode(cache).write(to: file)
        let client = try AgentChatClient(endpoint: endpoint, accountID: "owner", cacheURL: file, credential: { "fixture" })
        await client.openConversation("c")
        let state = await client.state(); await client.disconnect()
        XCTAssertEqual(state.snapshot?.timeline.map(\.id), ["message:a", "permission:p", "message:local"])
        let local = try XCTUnwrap(state.snapshot?.messages.last)
        XCTAssertTrue(local.isLocalEcho); XCTAssertEqual(local.delivery, "sent")
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(local))
        XCTAssertFalse(decoded.isLocalEcho)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(local), as: UTF8.self).contains("isLocalEcho"))
    }
}
