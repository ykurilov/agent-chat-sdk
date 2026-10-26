import Foundation
import Observation

/// One recording session. Partial is the entire unconfirmed suffix, final is a new
/// confirmed fragment (not the whole transcript). Deliver each final fragment once.
public enum AgentChatSpeechEvent: Sendable, Equatable {
    case partial(String)
    case final(String)
    case finished
    /// The application supplies a human-readable, localized message without secrets.
    case failed(String)
}

/// Application-owned recognition. Commands run on the main actor and must return
/// promptly; perform microphone/network work in application tasks. Each start creates
/// a fresh stream. Finish stops capture but allows final events; cancel releases
/// resources immediately and ends the stream. SDK does not record or call providers.
@MainActor public protocol AgentChatSpeechRecognizer: AnyObject {
    func start() throws -> AsyncStream<AgentChatSpeechEvent>
    func finish()
    func cancel()
}

public enum AgentChatDictationPhase: Sendable, Equatable {
    case idle, listening, finishing
    case failed(String)
}

/// Recognition lifecycle independent of the view. Only confirmed text reaches the
/// draft binding; cancellation and stale callbacks never append an old session.
@MainActor @Observable public final class AgentChatDictation {
    public private(set) var phase: AgentChatDictationPhase = .idle
    public private(set) var partialText = ""
    public var isActive: Bool { phase == .listening || phase == .finishing }
    @ObservationIgnored private var recognizer: (any AgentChatSpeechRecognizer)?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()

    public init() {}

    public func start(using recognizer: any AgentChatSpeechRecognizer, onFinal: @escaping @MainActor (String) -> Void) {
        guard !isActive else { return }
        cancel()
        let session = UUID()
        generation = session
        self.recognizer = recognizer
        phase = .listening
        do {
            let events = try recognizer.start()
            task = Task { [weak self] in
                for await event in events {
                    guard let self, generation == session, !Task.isCancelled else { return }
                    switch event {
                    case .partial(let text): partialText = text
                    case .final(let text):
                        partialText = ""
                        if !text.isEmpty { onFinal(text) }
                    case .finished:
                        complete(session: session, error: nil)
                        return
                    case .failed(let message):
                        complete(session: session, error: message)
                        return
                    }
                }
                guard !Task.isCancelled else { return }
                self?.complete(session: session, error: "Распознавание прервалось. Подтверждённый текст сохранён")
            }
        } catch {
            complete(session: session, error: error.localizedDescription)
        }
    }

    public func finish() {
        guard phase == .listening else { return }
        phase = .finishing
        recognizer?.finish()
    }

    public func cancel() {
        generation = UUID()
        task?.cancel(); task = nil
        let source = recognizer; recognizer = nil
        partialText = ""; phase = .idle
        source?.cancel()
    }

    private func complete(session: UUID, error: String?) {
        guard generation == session else { return }
        generation = UUID()
        let source = recognizer; recognizer = nil
        task = nil; partialText = ""
        if let error {
            phase = .failed(error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Не удалось распознать речь" : error)
            source?.cancel()
        } else { phase = .idle }
    }

    /// Read the draft at the time of each final event, preserving keyboard edits.
    public static func appending(_ fragment: String, to draft: String) -> String {
        guard !fragment.isEmpty else { return draft }
        guard let last = draft.last, let first = fragment.first,
              !last.isWhitespace, !first.isWhitespace,
              !".,!?;:…)]}».".contains(first) else { return draft + fragment }
        return draft + " " + fragment
    }

    deinit { task?.cancel() }
}
