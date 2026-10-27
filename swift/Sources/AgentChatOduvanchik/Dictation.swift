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
    public private(set) var isSendPending = false
    @ObservationIgnored private var sendAfterFinish: (@MainActor () -> Void)?
    @ObservationIgnored private var lastFinalDraft: String?
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
                        if !text.isEmpty { onFinal(text) }
                        partialText = ""
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

    /// Waits for all final fragments and exactly one successful terminal event.
    /// Reads the final draft only after finished; empty drafts never send.
    public func finishAndSend(draft: @escaping @MainActor () -> String, onSend: @escaping @MainActor () -> Void) {
        guard isActive, !isSendPending else { return }
        isSendPending = true
        sendAfterFinish = { if !draft().trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { onSend() } }
        finish()
    }

    /// Separators inside a continuous recognition session belong to the provider.
    /// A keyboard edit breaks continuity and starts a new draft/session boundary.
    public func appendFinal(_ fragment: String, to draft: String) -> String {
        guard !fragment.isEmpty else { return draft }
        let next = Self.appending(fragment, to: draft, separating: lastFinalDraft != draft)
        lastFinalDraft = next
        return next
    }

    public func cancel() {
        generation = UUID()
        task?.cancel(); task = nil
        let source = recognizer; recognizer = nil
        partialText = ""; phase = .idle
        sendAfterFinish = nil; isSendPending = false; lastFinalDraft = nil
        source?.cancel()
    }

    private func complete(session: UUID, error: String?) {
        guard generation == session else { return }
        generation = UUID()
        let source = recognizer; recognizer = nil
        task = nil; partialText = ""
        let send = error == nil ? sendAfterFinish : nil
        sendAfterFinish = nil; isSendPending = false; lastFinalDraft = nil
        if let error {
            phase = .failed(error.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Не удалось распознать речь" : error)
            source?.cancel()
        } else { phase = .idle }
        send?()
    }

    /// Literal concatenation by default. Only the first fragment at a session or
    /// keyboard boundary uses separating=true. Prefer appendFinal for a session.
    public static func appending(_ fragment: String, to draft: String, separating: Bool = false) -> String {
        guard !fragment.isEmpty else { return draft }
        guard separating else { return draft + fragment }
        guard let last = draft.last, let first = fragment.first,
              !last.isWhitespace, !first.isWhitespace,
              !".,!?;:…)]}».".contains(first) else { return draft + fragment }
        return draft + " " + fragment
    }

    deinit { task?.cancel() }
}
