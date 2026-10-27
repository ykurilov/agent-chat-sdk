import XCTest
import AgentChatOduvanchik

@MainActor private final class Recognizer: AgentChatSpeechRecognizer {
    var streams: [AsyncStream<AgentChatSpeechEvent>.Continuation] = []
    var starts = 0, finishes = 0, cancellations = 0
    var failStart = false
    func start() throws -> AsyncStream<AgentChatSpeechEvent> {
        starts += 1
        if failStart { throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Нет доступа к микрофону"]) }
        let pair = AsyncStream<AgentChatSpeechEvent>.makeStream()
        streams.append(pair.continuation)
        return pair.stream
    }
    func finish() { finishes += 1 }
    func cancel() { cancellations += 1 }
}

final class DictationTests: XCTestCase {
    @MainActor func testProviderFragmentsPreserveSubwordAndLeadingSpaceBoundaries() {
        XCTAssertEqual(AgentChatDictation.appending("ка", to: "кноп"), "кнопка")
        XCTAssertEqual(AgentChatDictation.appending(" работает", to: " кнопка"), " кнопка работает")
        XCTAssertEqual(AgentChatDictation.appending("жен", to: "дол"), "должен")
    }

    @MainActor private func drain() async { for _ in 0..<30 { await Task.yield() } }

    @MainActor func testPartialIsReplaceableFinalAppendsToLatestDraftAndFinishWaits() async {
        let recognizer = Recognizer(), model = AgentChatDictation()
        var draft = "Набрано"
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        XCTAssertEqual(model.phase, .listening)
        model.start(using: recognizer) { _ in XCTFail("duplicate start") }
        XCTAssertEqual(recognizer.starts, 1)
        recognizer.streams[0].yield(.partial("при")); await drain()
        XCTAssertEqual(model.partialText, "при"); XCTAssertEqual(draft, "Набрано")
        recognizer.streams[0].yield(.partial("привет")); await drain()
        XCTAssertEqual(model.partialText, "привет")
        draft += " с клавиатуры"
        recognizer.streams[0].yield(.final("привет")); await drain()
        XCTAssertEqual(draft, "Набрано с клавиатуры привет"); XCTAssertEqual(model.partialText, "")
        model.finish(); model.finish()
        XCTAssertEqual(model.phase, .finishing); XCTAssertTrue(model.isActive); XCTAssertEqual(recognizer.finishes, 1)
        recognizer.streams[0].yield(.final(" мир")); recognizer.streams[0].yield(.finished); await drain()
        XCTAssertEqual(draft, "Набрано с клавиатуры привет мир"); XCTAssertEqual(model.phase, .idle)
        XCTAssertFalse(model.isActive)
    }

    @MainActor func testCancelKeepsConfirmedTextAndFencesLateOldEventsAfterRestart() async {
        let recognizer = Recognizer(), model = AgentChatDictation()
        var draft = ""
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        recognizer.streams[0].yield(.final("Остаётся")); recognizer.streams[0].yield(.partial("удаляется")); await drain()
        model.cancel()
        XCTAssertEqual(recognizer.cancellations, 1); XCTAssertEqual(model.partialText, "")
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        recognizer.streams[0].yield(.final("старый хвост")); recognizer.streams[0].yield(.finished)
        recognizer.streams[1].yield(.partial("новый")); await drain()
        XCTAssertEqual(draft, "Остаётся"); XCTAssertEqual(model.partialText, "новый"); XCTAssertEqual(model.phase, .listening)
        model.cancel()
    }

    @MainActor func testErrorsAndUnexpectedEndKeepConfirmedDraftAndPermitRetry() async {
        let recognizer = Recognizer(), model = AgentChatDictation()
        var draft = "Свой текст"
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        recognizer.streams[0].yield(.final("подтверждено")); recognizer.streams[0].yield(.failed("Связь с распознавателем потеряна")); await drain()
        XCTAssertEqual(model.phase, .failed("Связь с распознавателем потеряна")); XCTAssertEqual(draft, "Свой текст подтверждено"); XCTAssertFalse(model.isActive)
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        recognizer.streams[1].yield(.partial("не подтверждено")); recognizer.streams[1].finish(); await drain()
        guard case .failed = model.phase else { return XCTFail("unexpected stream end must not be success") }
        XCTAssertEqual(draft, "Свой текст подтверждено"); XCTAssertEqual(model.partialText, "")
        recognizer.failStart = true
        model.start(using: recognizer) { _ in XCTFail() }
        XCTAssertEqual(model.phase, .failed("Нет доступа к микрофону")); XCTAssertEqual(draft, "Свой текст подтверждено")
    }

    @MainActor func testFinishedNeverCommitsUnconfirmedPartial() async {
        let recognizer = Recognizer(), model = AgentChatDictation()
        var draft = "Было"
        model.start(using: recognizer) { draft = model.appendFinal($0, to: draft) }
        recognizer.streams[0].yield(.partial("сомнительный текст")); recognizer.streams[0].yield(.finished); await drain()
        XCTAssertEqual(draft, "Было"); XCTAssertEqual(model.partialText, ""); XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(AgentChatDictation.appending(", да", to: draft), "Было, да")
        XCTAssertEqual(AgentChatDictation.appending("текст", to: ""), "текст")
        XCTAssertEqual(AgentChatDictation.appending(" текст", to: "Было "), "Было  текст")
    }
    @MainActor func testSessionAppendSeparatesOnlyInitialOrKeyboardBoundary() async {
        let source = Recognizer(), model = AgentChatDictation()
        var draft = "Набрано"
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        for part in ["кноп", "ка", " работает"] { source.streams[0].yield(.final(part)) }
        await drain()
        XCTAssertEqual(draft, "Набрано кнопка работает")
        draft += " вручную"
        source.streams[0].yield(.final("дол")); source.streams[0].yield(.final("жен")); await drain()
        XCTAssertEqual(draft, "Набрано кнопка работает вручную должен")
        source.streams[0].yield(.finished); await drain()
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        source.streams[1].yield(.final("тест")); source.streams[1].yield(.final(", да")); await drain()
        XCTAssertEqual(draft, "Набрано кнопка работает вручную должен тест, да")
        model.cancel()
    }

    @MainActor func testSendWaitsForEveryFinalAndOnlyOneFinished() async {
        let source = Recognizer(), model = AgentChatDictation()
        var draft = "", sent: [String] = []
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        source.streams[0].yield(.partial("кнопка")); await drain()
        model.finishAndSend(draft: { draft }) { sent.append(draft) }
        model.finishAndSend(draft: { draft }) { XCTFail("double send") }
        XCTAssertTrue(model.isSendPending); XCTAssertEqual(source.finishes, 1); XCTAssertEqual(sent, [])
        source.streams[0].yield(.final("кноп")); source.streams[0].yield(.final("ка")); await drain()
        XCTAssertEqual(sent, []); XCTAssertEqual(draft, "кнопка")
        source.streams[0].yield(.final(" работает")); source.streams[0].yield(.finished); source.streams[0].yield(.finished); await drain()
        XCTAssertEqual(sent, ["кнопка работает"]); XCTAssertFalse(model.isSendPending)
        XCTAssertEqual(model.phase, .idle)
    }

    @MainActor func testSendAfterManualFinishButFailureCancelAndEmptyNeverSend() async {
        let source = Recognizer(), model = AgentChatDictation()
        var draft = "", sent: [String] = []
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        model.finish()
        model.finishAndSend(draft: { draft }) { sent.append(draft) }
        XCTAssertEqual(source.finishes, 1)
        source.streams[0].yield(.final("готово")); source.streams[0].yield(.failed("Ошибка связи")); await drain()
        XCTAssertEqual(draft, "готово"); XCTAssertEqual(sent, []); XCTAssertFalse(model.isSendPending)
        draft = "   "
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        model.finishAndSend(draft: { draft }) { XCTFail("empty send") }
        source.streams[1].yield(.finished); await drain()
        XCTAssertEqual(sent, [])
        model.start(using: source) { draft = model.appendFinal($0, to: draft) }
        model.finishAndSend(draft: { draft }) { XCTFail("canceled send") }
        model.cancel(); source.streams[2].yield(.final("поздно")); source.streams[2].yield(.finished); await drain()
        XCTAssertEqual(draft, "   "); XCTAssertFalse(model.isSendPending)
    }

}
