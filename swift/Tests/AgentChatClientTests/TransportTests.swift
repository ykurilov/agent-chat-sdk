import XCTest
@testable import AgentChatClient

@MainActor final class TransportTests: XCTestCase {
    func testCatchupPublishesBatchesAndLiveAnswerStillStreams() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: cache.deletingLastPathComponent()) }
        func control(_ path: String) async throws {
            var url = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!; url.path = "/fixture/" + path
            _ = try await URLSession.shared.data(from: url.url!)
        }
        try await control("hold-events")
        let client = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        await client.openConversation("catchup")
        try await until { await client.state().snapshot?.conversation.id == "catchup" }
        var counts: [Int] = [], live: [String] = []
        let updates = await client.updates()
        let observer = Task {
            for await state in updates {
                if let snapshot = state.snapshot, snapshot.conversation.id == "catchup" {
                    counts.append(snapshot.messages.filter { $0.id.hasPrefix("catchup-") && $0.role == "user" }.count)
                    if let text = snapshot.messages.first(where: { $0.id == "catchup-live" })?.text, live.last != text { live.append(text) }
                }
            }
        }
        defer { observer.cancel() }
        try await control("catchup-burst"); try await control("release-events")
        try await client.setDraft("Typed during catch-up", chatId: "catchup")
        try await until { await client.state().snapshot?.messages.filter { $0.role == "user" }.count == 100 }
        try await until { counts.contains(100) }
        print("CATCHUP_PUBLICATIONS", counts.filter { $0 > 0 }.count)
        XCTAssertLessThan(counts.filter { $0 > 0 }.count, 10, "Catch-up must not publish each event")
        let draft = await client.draft(chatId: "catchup")
        XCTAssertEqual(draft, "Typed during catch-up")
        let saved = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: cache)) as? [String: Any])
        let snapshots = try XCTUnwrap(saved["snapshots"] as? [String: [String: Any]])
        XCTAssertEqual((snapshots["catchup"]?["messages"] as? [Any])?.count, 100, "Published cursor must be durable")
        try await control("catchup-live")
        try await until { await client.state().snapshot?.messages.last?.text == "Live answer done" }
        try await until { live.last == "Live answer done" }
        XCTAssertEqual(live, ["Live", "Live answer", "Live answer done"])
        await client.disconnect()
    }
    func testAcknowledgedTextRemainsOnDeviceUntilProjectionArrives() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: cache.deletingLastPathComponent()) }
        func control(_ path: String) async throws {
            var url = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!; url.path = "/fixture/" + path
            _ = try await URLSession.shared.data(from: url.url!)
        }
        try await control("hold-events")
        let client = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        await client.connect(); await client.openConversation("offline-cache")
        try await until { await client.state().snapshot?.conversation.id == "offline-cache" }
        let id = try await client.send("Сохранить на устройстве после 202", chatId: "offline-cache")
        // Wait for receipt processing in both the old (removed) and fixed (acknowledged) outbox.
        try await until {
            guard let command = await client.state().pending.first(where: { $0.id == id }) else { return true }
            guard let data = try? JSONEncoder().encode(command), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return object["acknowledged"] as? Bool == true
        }
        let state = await client.state()
        XCTAssertTrue(state.snapshot?.messages.contains(where: { $0.id == id && $0.isLocalEcho }) == true)
        await client.disconnect()
        let restored = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        let pending = await restored.state().pending
        XCTAssertEqual(pending.first(where: { $0.id == id })?.text, "Сохранить на устройстве после 202")
        try await control("release-events")
        await restored.connect(); await restored.openConversation("offline-cache")
        try await until { await restored.state().pending.allSatisfy { $0.id != id } }
        let confirmed = await restored.state()
        XCTAssertEqual(confirmed.snapshot?.messages.filter { $0.id == id }.count, 1)
        await restored.disconnect()
    }
    func testRealHTTPQueueStreamPermissionStopAndRestart() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else {
            throw XCTSkip("Requires local SDK fixture; no remote provider calls")
        }
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: cache.deletingLastPathComponent()) }
        let client = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        await client.connect()
        try await until { await client.state().snapshot != nil }
        let id = try await client.send("Первое сообщение", chatId: "main")
        try await until { await client.state().snapshot?.messages.contains(where: { $0.id == id && $0.delivery == "queued" }) == true }
        var online = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!
        online.path = "/fixture/online"
        _ = try await URLSession.shared.data(from: online.url!)
        try await until { await client.state().snapshot?.permissions.contains(where: { $0.status == "open" }) == true }
        let waiting = await client.state()
        XCTAssertEqual(waiting.snapshot?.messages.filter { $0.id == id }.count, 1)
        XCTAssertEqual(waiting.snapshot?.messages.last?.text, "Пишу ответ")
        let permission = try XCTUnwrap(waiting.snapshot?.permissions.first)
        try await client.answer(permission.id, chatId: "main", decision: PermissionDecision(actionId: "allow"))
        try await until { await client.state().snapshot?.messages.last?.text == "Готово" }
        try await until { await client.state().snapshot?.turn.status == "idle" }
        let oldState = await client.state()
        let oldCursor = try XCTUnwrap(oldState.snapshot?.cursor)
        await client.disconnect()
        let restored = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        await restored.connect()
        try await until { await restored.state().network == .connected }
        let resumed = await restored.state()
        XCTAssertGreaterThanOrEqual(resumed.snapshot?.cursor ?? -1, oldCursor)
        XCTAssertEqual(resumed.snapshot?.messages.filter { $0.id == id }.count, 1)
        try await restored.send("stop me", chatId: "main")
        try await until { await restored.state().snapshot?.turn.status == "running" }
        try await restored.stop(chatId: "main")
        try await until { await restored.state().snapshot?.turn.status == "stopped" }
        await restored.disconnect()
    }
    func testDisconnectFencesAnOlderConnectCompletion() async throws {
        guard let root = ProcessInfo.processInfo.environment["AGENT_CHAT_TEST_ENDPOINT"], let endpoint = URL(string: root) else { throw XCTSkip("Requires local fixture") }
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("state.json")
        defer { try? FileManager.default.removeItem(at: cache.deletingLastPathComponent()) }
        let client = try AgentChatClient(endpoint: endpoint, accountID: "fixture", cacheURL: cache, credential: { "fixture-only" })
        func control(_ path: String) async throws -> Data {
            var url = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)!; url.path = "/fixture/" + path
            return try await URLSession.shared.data(from: url.url!).0
        }
        _ = try await control("hold-list")
        let pendingID = try await client.send("Keep local after logout", chatId: "main")
        let connecting = Task { await client.connect() }
        try await until { (try? await control("list-count")) == Data("1".utf8) }
        await client.disconnect()
        _ = try await control("release-list")
        await connecting.value
        let state = await client.state()
        XCTAssertEqual(state.network, .disconnected); XCTAssertNil(state.selectedChatId)
        XCTAssertEqual(state.pending.first?.id, pendingID)
    }
    private func until(_ condition: () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("Native transport condition timed out"); throw ChatClientError.invalidResponse
    }
}
