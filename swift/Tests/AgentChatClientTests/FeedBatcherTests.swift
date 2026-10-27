import XCTest
@testable import AgentChatClient

@MainActor final class FeedBatcherTests: XCTestCase {
    private func event(_ seq: Int) -> ChatFeedEvent { ChatFeedEvent(seq: seq, chatId: "c", type: "message", message: ChatMessage(id: "m", role: "assistant", text: "\(seq)", createdAt: "", revision: seq)) }
    func testCatchupBurstKeepsOrderWithFewerPublications() async throws {
        let (stream, continuation) = AsyncThrowingStream<[ChatFeedEvent], any Error>.makeStream(bufferingPolicy: .bufferingOldest(8))
        let batcher = ChatFeedBatcher(continuation)
        for seq in 1...100 { await batcher.append(event(seq)) }
        await batcher.finish()
        var batches: [[ChatFeedEvent]] = []
        for try await batch in stream { batches.append(batch) }
        XCTAssertEqual(batches.flatMap { $0 }.map(\.seq), Array(1...100))
        XCTAssertLessThan(batches.count, 10)
    }
    func testIsolatedLiveUpdateDoesNotWaitForAnotherEvent() async throws {
        let (stream, continuation) = AsyncThrowingStream<[ChatFeedEvent], any Error>.makeStream()
        let batcher = ChatFeedBatcher(continuation)
        let deadline = Task { try? await Task.sleep(for: .seconds(2)); if !Task.isCancelled { continuation.finish(throwing: ChatClientError.invalidResponse) } }
        defer { deadline.cancel() }
        await batcher.append(event(1))
        var iterator = stream.makeAsyncIterator()
        let first = try await iterator.next()
        XCTAssertEqual(first?.map(\.seq), [1])
        await batcher.append(event(2))
        let second = try await iterator.next()
        XCTAssertEqual(second?.map(\.seq), [2])
        await batcher.finish()
    }
    func testTerminalErrorFlushesValidPendingEventsBeforeError() async throws {
        let (stream, continuation) = AsyncThrowingStream<[ChatFeedEvent], any Error>.makeStream()
        let batcher = ChatFeedBatcher(continuation)
        await batcher.append(event(1)); await batcher.finish(ChatClientError.cursorReset)
        var iterator = stream.makeAsyncIterator()
        let first = try await iterator.next()
        XCTAssertEqual(first?.map(\.seq), [1])
        do { _ = try await iterator.next(); XCTFail("Expected cursor reset") }
        catch ChatClientError.cursorReset {} catch { XCTFail("Unexpected \(error)") }
    }
    func testLargeEventsFlushByByteBudgetAndOverflowRequiresReplay() async throws {
        let (stream, continuation) = AsyncThrowingStream<[ChatFeedEvent], any Error>.makeStream(bufferingPolicy: .bufferingOldest(8))
        let batcher = ChatFeedBatcher(continuation)
        for seq in 1...10 { await batcher.append(event(seq), byteCount: 300_000) }
        var received: [Int] = []
        do { for try await batch in stream { received += batch.map(\.seq) }; XCTFail("Expected bounded buffer overflow") }
        catch ChatClientError.invalidResponse {} catch { XCTFail("Unexpected \(error)") }
        XCTAssertEqual(received, Array(1...8), "Only the contiguous delivered prefix may be acknowledged")
        await batcher.cancel()
    }

}
