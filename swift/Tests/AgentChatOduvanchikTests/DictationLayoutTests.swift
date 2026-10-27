import XCTest
@testable import AgentChatOduvanchik
@MainActor final class DictationLayoutTests: XCTestCase {
    func testPartialAndFinalHaveIdenticalVisibleCharactersAtSessionBoundary() async {
        let source = LayoutRecognizer(), model = AgentChatDictation()
        var draft = "Набрано"
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        source.events.yield(.partial("кноп")); await drain()
        let before = model.previewDraft(draft)
        XCTAssertEqual(before, "Набрано кноп")
        source.events.yield(.final("кноп")); await drain()
        XCTAssertEqual(model.previewDraft(draft), before)
        source.events.yield(.partial("ка работает")); await drain()
        XCTAssertEqual(model.previewDraft(draft), "Набрано кнопка работает")
        source.events.yield(.final("ка работает")); await drain()
        XCTAssertEqual(model.previewDraft(draft), "Набрано кнопка работает")
        model.cancel()
    }
    func testLeadingProviderSeparatorDoesNotIndentEmptyEditor() async {
        let source = LayoutRecognizer(), model = AgentChatDictation()
        var draft = ""
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        source.events.yield(.partial(" кнопка")); await drain()
        XCTAssertEqual(model.previewDraft(draft), "кнопка")
        source.events.yield(.final(" кнопка")); await drain()
        XCTAssertEqual(draft, "кнопка")
        source.events.yield(.partial(" работает")); await drain()
        XCTAssertEqual(model.previewDraft(draft), "кнопка работает")
        model.cancel()
    }
    private func drain() async { for _ in 0..<30 { await Task.yield() } }
}
@MainActor private final class LayoutRecognizer: AgentChatSpeechRecognizer {
    let pair = AsyncStream<AgentChatSpeechEvent>.makeStream()
    var events: AsyncStream<AgentChatSpeechEvent>.Continuation { pair.continuation }
    func start() throws -> AsyncStream<AgentChatSpeechEvent> { pair.stream }
    func finish() {}
    func cancel() { pair.continuation.finish() }
}
