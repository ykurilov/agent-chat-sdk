import XCTest
@testable import AgentChatClient

final class ProtocolTests: XCTestCase {
    func testSSEHandlesCommentsMultilineAndEventBoundary() throws {
        var parser = SSEParser()
        XCTAssertNil(try parser.consume(": heartbeat"))
        XCTAssertNil(try parser.consume("id: 7"))
        XCTAssertNil(try parser.consume("event: change"))
        XCTAssertNil(try parser.consume("data: first"))
        XCTAssertNil(try parser.consume("data: second"))
        let frame = try XCTUnwrap(parser.consume(""))
        XCTAssertEqual(frame.id, "7"); XCTAssertEqual(frame.event, "change"); XCTAssertEqual(frame.data, "first\nsecond")
        XCTAssertNil(try parser.consume(""))
    }
    func testReducerReplayGapAndCumulativeText() throws {
        var snapshot = try JSONDecoder().decode(ChatSnapshot.self, from: Data(Self.snapshot.utf8))
        let data = #"{"version":1,"seq":1,"chatId":"main","type":"message","message":{"id":"a","role":"assistant","text":"Привет","createdAt":"2026-10-26T00:00:00Z","revision":2,"status":"streaming"}}"#
        let event = try JSONDecoder().decode(ChatFeedEvent.self, from: Data(data.utf8))
        try ChatReducer.apply(event, to: &snapshot); try ChatReducer.apply(event, to: &snapshot)
        XCTAssertEqual(snapshot.cursor, 1); XCTAssertEqual(snapshot.messages.count, 1); XCTAssertEqual(snapshot.messages[0].text, "Привет")
        let gap = try JSONDecoder().decode(ChatFeedEvent.self, from: Data(data.replacingOccurrences(of: "\"seq\":1", with: "\"seq\":3").utf8))
        XCTAssertThrowsError(try ChatReducer.apply(gap, to: &snapshot)); XCTAssertEqual(snapshot.cursor, 1)
    }
    func testLocalOutboxAndDraftSurviveClientRestart() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("cache.json")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let client = try AgentChatClient(endpoint: URL(string: "http://127.0.0.1:9139/api/conversations")!, accountID: "owner", cacheURL: url, credential: { "token" })
        try await client.setDraft("Не терять", chatId: "main")
        let id = try await client.send("Текст", chatId: "main")
        let restored = try AgentChatClient(endpoint: URL(string: "http://127.0.0.1:9139/api/conversations")!, accountID: "owner", cacheURL: url, credential: { "new token" })
        let state = await restored.state()
        XCTAssertEqual(state.pending.count, 1); XCTAssertEqual(state.pending[0].id, id); XCTAssertEqual(state.pending[0].text, "Текст")
        let draft = await restored.draft(chatId: "main"); XCTAssertEqual(draft, "")
        let content = try String(contentsOf: url, encoding: .utf8); XCTAssertFalse(content.contains("new token"))
        XCTAssertThrowsError(try AgentChatClient(endpoint: URL(string: "http://127.0.0.1:9139/api/conversations")!, accountID: "other", cacheURL: url, credential: { "token" }))
    }
    static let snapshot = #"{"version":1,"conversation":{"id":"main","title":"Главный","pinned":true,"execution":{"kind":"external"},"updatedAt":"2026-10-26T00:00:00Z","connection":"idle"},"cursor":0,"messages":[],"permissions":[],"turn":{"status":"idle","generation":0}}"#
}
