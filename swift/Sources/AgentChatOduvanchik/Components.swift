import SwiftUI
import AgentChatClient
import YKDesign

/// Шапка беседы: слева кнопка (список чатов), название чата, под ним — кто отвечает, справа — состояние.
public struct AgentChatHeader<Leading: View, Subtitle: View>: View {
    let title: String
    let status: String
    let statusKind: YKChipKind
    let leading: Leading
    let subtitle: Subtitle

    public init(
        _ title: String, status: String, statusKind: YKChipKind,
        @ViewBuilder leading: () -> Leading, @ViewBuilder subtitle: () -> Subtitle
    ) {
        self.title = title
        self.status = status
        self.statusKind = statusKind
        self.leading = leading()
        self.subtitle = subtitle()
    }

    public var body: some View {
        HStack(spacing: YKTokens.Space.s3) {
            leading
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .ykText(.body, weight: 600)
                    .foregroundStyle(YKColorRole.text.color)
                    .lineLimit(1)
                    .accessibilityIdentifier("chat-title")
                subtitle
            }
            Spacer(minLength: YKTokens.Space.s2)
            YKChip(status, kind: statusKind)
                .accessibilityElement(children: .ignore)
                .accessibilityIdentifier("manager-status")
                .accessibilityLabel(Text("Состояние: \(status)"))
        }
        .padding(.horizontal, YKTokens.Space.s4)
        .frame(minHeight: AgentChatMetrics.headerHeight)
    }
}

/// Подпись под названием чата: кто отвечает.
public struct AgentChatResponderLabel: View {
    let text: String

    public init(_ text: String) { self.text = text }

    public var body: some View {
        Text(text)
            .ykText(.small, size: 12.5)
            .foregroundStyle(YKColorRole.muted.color)
            .lineLimit(1)
    }
}

/// Сообщение пользователя: мягкий пузырь справа.
public struct AgentChatUserBubble: View {
    let text: String

    public init(_ text: String) { self.text = text }

    public var body: some View {
        Text(text)
            .ykText(.body)
            .foregroundStyle(YKColorRole.text.color)
            .textSelection(.enabled)
            .padding(.horizontal, AgentChatMetrics.bubbleHorizontalPadding)
            .padding(.vertical, AgentChatMetrics.bubbleVerticalPadding)
            .background(YKColorRole.surface2.color, in: RoundedRectangle(cornerRadius: AgentChatMetrics.bubbleRadius, style: .continuous))
            .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in
                (width - 2 * AgentChatMetrics.columnPadding) * AgentChatMetrics.bubbleMaxWidthShare
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// «Агент думает»: сфера и короткая подпись, пока нет ни слова ответа.
public struct AgentChatThinkingRow: View {
    let label: String

    public init(_ label: String) { self.label = label }

    public var body: some View {
        HStack(spacing: YKTokens.Space.s2) {
            YKSphere(size: 18)
            Text(label).ykText(.small).foregroundStyle(YKColorRole.muted.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Подпись под неотправленным сообщением: что случилось и кнопка повтора.
public struct AgentChatDeliveryNote: View {
    public enum Kind: Sendable { case sending, failed }

    let kind: Kind
    let text: String
    let retryTitle: String
    let onRetry: (() -> Void)?

    public init(_ text: String, kind: Kind, retryTitle: String = "Повторить", onRetry: (() -> Void)? = nil) {
        self.text = text
        self.kind = kind
        self.retryTitle = retryTitle
        self.onRetry = onRetry
    }

    public var body: some View {
        HStack(spacing: YKTokens.Space.s1 + 2) {
            if kind == .failed {
                YKIcon(.warningCircle, size: 14).foregroundStyle(YKColorRole.danger.color)
            }
            Text(text)
                .ykText(.small, size: 12.5)
                .foregroundStyle(kind == .failed ? YKColorRole.danger.color : YKColorRole.muted.color)
                .multilineTextAlignment(.trailing)
            if kind == .failed, let onRetry {
                Button(retryTitle, action: onRetry)
                    .buttonStyle(.yk(.link, size: .sm))
                    .accessibilityIdentifier("retry")
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Общая строка ввода. Распознаватель необязателен; без него микрофона нет.
public struct AgentChatComposer: View {
    @Binding var text: String
    let placeholder: String
    let onStop: (() -> Void)?
    let onSend: () -> Void
    let enabled: Bool
    let stopEnabled: Bool
    let speechRecognizer: (any AgentChatSpeechRecognizer)?
    /// Change when switching conversations to discard unconfirmed speech from the old chat.
    let speechContextId: String?
    let attachmentController: AgentChatAttachmentController?
    let modelSelection: AgentChatComposerModelSelection?
    @State private var dictation = AgentChatDictation()
    @FocusState private var isFocused: Bool
    @State private var inlineFocused = false
    @State private var nativeProjectionRevision = 0
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.isEnabled) private var inheritedEnabled

    public init(text: Binding<String>, placeholder: String, onStop: (() -> Void)? = nil, enabled: Bool = true, stopEnabled: Bool = true, speechRecognizer: (any AgentChatSpeechRecognizer)? = nil, speechContextId: String? = nil, attachmentController: AgentChatAttachmentController? = nil, modelSelection: AgentChatComposerModelSelection? = nil, onSend: @escaping () -> Void) {
        _text = text
        self.placeholder = placeholder; self.onStop = onStop; self.onSend = onSend
        self.enabled = enabled; self.stopEnabled = stopEnabled
        self.speechRecognizer = speechRecognizer; self.speechContextId = speechContextId; self.attachmentController = attachmentController; self.modelSelection = modelSelection
    }

    private var canSend: Bool { inheritedEnabled && enabled && (attachmentController?.isReady ?? true) && !dictation.isSendPending && (dictation.isActive || !(attachmentController?.files.isEmpty ?? true) || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
    private var recognizerId: ObjectIdentifier? { speechRecognizer.map { ObjectIdentifier($0) } }

    @ViewBuilder private var dictationInput: some View {
        #if canImport(UIKit)
        let _ = nativeProjectionRevision
        let draftSnapshot = text
        if speechRecognizer != nil {
            AgentChatInlineDictationInput(text: $text, focused: $inlineFocused, draftSnapshot: draftSnapshot, displayText: dictation.previewDraft(draftSnapshot), placeholder: placeholder, active: dictation.isActive, enabled: enabled && inheritedEnabled, onNeedsProjection: { nativeProjectionRevision &+= 1 })
                .id(speechContextId)
        } else {
            plainInput
        }
        #else
        VStack(alignment: .leading, spacing: YKTokens.Space.s1) {
            plainInput
            if !dictation.partialText.isEmpty { Text(dictation.partialText).ykText(.body).foregroundStyle(YKColorRole.muted.color) }
        }
        #endif
    }
    private var plainInput: some View {
        TextField(text: $text, axis: .vertical) { Text(placeholder) }
            .ykText(.body).foregroundStyle(YKColorRole.text.color).tint(YKColorRole.accent.color)
            .lineLimit(1...6).focused($isFocused).accessibilityIdentifier("composer").disabled(!enabled)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s2) {
            if let attachmentController { AgentChatDraftAttachments(controller: attachmentController) }
            dictationInput
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
            HStack(alignment: .bottom, spacing: YKTokens.Space.s2 - 2) {
                if let attachmentController { AgentChatAttachmentButton(controller: attachmentController, composerEdge: true).disabled(!enabled || dictation.isSendPending) }
                if let modelSelection {
                    AgentChatModelPicker(state: modelSelection.state, enabled: enabled && !dictation.isActive && modelSelection.enabled, showReasoning: modelSelection.showReasoning, warning: modelSelection.warning, presentation: .composer, onChange: modelSelection.onChange)
                        .layoutPriority(-1)
                }
                Spacer(minLength: YKTokens.Space.s2)
                if let onStop {
                    YKIconButton(.stop, label: "Остановить", variant: .secondary, size: .md, iconWeight: .fill, action: onStop)
                        .accessibilityIdentifier("stop").disabled(!stopEnabled)
                }
                if speechRecognizer != nil && dictation.isActive {
                    YKIconButton(.x, label: "Отменить диктовку", variant: .secondary, size: .md) { dictation.cancel() }
                        .accessibilityIdentifier("dictation-cancel")
                }
                if let speechRecognizer {
                    YKIconButton(dictation.isActive ? .stop : .microphone, label: dictation.isActive ? "Закончить диктовку" : "Начать диктовку", variant: .secondary, size: .md) {
                        if dictation.isActive { dictation.finish() }
                        else { dictation.start(using: speechRecognizer) { fragment in text = dictation.appendFinal(fragment, to: text) } }
                    }
                    .accessibilityIdentifier("dictation-microphone")
                    .accessibilityValue(Text(dictation.phase == .listening ? "Слушаю" : dictation.phase == .finishing ? "Дорасшифровываю" : ""))
                    .disabled(!enabled || dictation.phase == .finishing)
                }
                Button {
                    guard canSend else { return }
                    if dictation.isActive {
                        dictation.finishAndSend(draft: { text }, attachmentsPresent: { !(attachmentController?.files.isEmpty ?? true) }) { onSend() }
                    } else { onSend() }
                } label: {
                    YKIcon(.arrowUp, size: 18)
                        .foregroundStyle(canSend ? YKColorRole.onInk.color : YKColorRole.muted.color)
                        .frame(width: AgentChatMetrics.sendButtonSide, height: AgentChatMetrics.sendButtonSide)
                        .background(canSend ? YKColorRole.ink.color : YKColorRole.border.color, in: Circle())
                }
                .buttonStyle(AgentChatSendButtonStyle()).disabled(!canSend)
                .accessibilityLabel(Text("Отправить")).accessibilityIdentifier("send")
                .accessibilityValue(Text(dictation.isSendPending ? "Ожидание окончания распознавания" : ""))
            }
            // The input keeps its text inset; the controls use optical edges of their own.
            .padding(.leading, attachmentController == nil ? 0 : -YKTokens.Space.s5)
            .padding(.trailing, YKTokens.Space.s2)
            if case .failed(let message) = dictation.phase {
                Text(message).ykText(.small).foregroundStyle(YKColorRole.danger.color)
                    .accessibilityIdentifier("dictation-error")
            }
        }
        .padding(.leading, YKTokens.Space.s5)
        .padding([.trailing, .vertical], YKTokens.Space.s2)
        .background(YKColorRole.surface2.color, in: RoundedRectangle(cornerRadius: AgentChatMetrics.composerRadius, style: .continuous))
        .task(id: attachmentController?.chatId) { await attachmentController?.observe() }
        .onDisappear { dictation.cancel() }
        .onChange(of: inheritedEnabled) { _, enabled in if !enabled { dictation.cancel() } }
        .onChange(of: scenePhase) { _, phase in if phase == .background { dictation.cancel() } }
        .onChange(of: speechContextId) { _, _ in dictation.cancel() }
        .onChange(of: recognizerId) { _, _ in dictation.cancel() }
        .onChange(of: enabled) { _, enabled in if !enabled { dictation.cancel() } }
    }
}

/// Вопрос «да/нет» прямо в ленте: кто спрашивает, вопрос и варианты кнопками.
/// После ответа кнопки сменяются меткой с выбранным вариантом.
public struct AgentChatApprovalCard: View {
    public struct Option: Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String
        /// Главная кнопка — чёрная, одна на карточку.
        public let isPrimary: Bool

        public init(id: String, title: String, isPrimary: Bool) {
            self.id = id
            self.title = title
            self.isPrimary = isPrimary
        }
    }

    let label: String
    let question: String
    let options: [Option]
    let answer: String?
    let onAnswer: (Option) -> Void

    public init(label: String, question: String, options: [Option], answer: String?, onAnswer: @escaping (Option) -> Void) {
        self.label = label
        self.question = question
        self.options = options
        self.answer = answer
        self.onAnswer = onAnswer
    }

    public var body: some View {
        YKCard(spacing: YKTokens.Space.s3) {
            HStack(spacing: YKTokens.Space.s2) {
                if answer == nil { YKNewDot() }
                Text(label).ykMonoLabel(color: answer == nil ? .accentText : .muted)
            }
            AgentChatMarkdown(question)
            if let answer {
                YKChip(answer, kind: .success)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: YKTokens.Space.s2) { buttons }
                    VStack(spacing: YKTokens.Space.s2) { buttons }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approval")
    }

    @ViewBuilder private var buttons: some View {
        ForEach(options) { option in
            Button { onAnswer(option) } label: {
                Text(option.title).frame(maxWidth: .infinity)
            }
            .buttonStyle(.yk(option.isPrimary ? .primary : .secondary, size: .lg))
        }
    }
}

private struct DictationInputHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

// Apply the explicit enabled/disabled palette once. PlainButtonStyle additionally dims
// a disabled label, which makes the muted arrow unreadable on its circle.
private struct AgentChatSendButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
    }
}
