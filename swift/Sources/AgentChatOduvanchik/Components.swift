import SwiftUI
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

/// Поле ввода беседы: текст растёт до шести строк, справа — чёрная круглая кнопка отправки.
public struct AgentChatComposer: View {
    @Binding var text: String
    let placeholder: String
    /// Остановка остаётся доступна рядом с отправкой, в том числе при набранной поправке.
    let onStop: (() -> Void)?
    let onSend: () -> Void
    let enabled: Bool
    let stopEnabled: Bool
    @FocusState private var isFocused: Bool

    public init(text: Binding<String>, placeholder: String, onStop: (() -> Void)? = nil, enabled: Bool = true, stopEnabled: Bool = true, onSend: @escaping () -> Void) {
        _text = text
        self.placeholder = placeholder
        self.onStop = onStop
        self.onSend = onSend
        self.enabled = enabled; self.stopEnabled = stopEnabled
    }

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var body: some View {
        HStack(alignment: .bottom, spacing: YKTokens.Space.s2 - 2) {
            TextField(text: $text, axis: .vertical) {
                Text(placeholder)
            }
            .ykText(.body)
            .foregroundStyle(YKColorRole.text.color)
            .tint(YKColorRole.accent.color)
            .lineLimit(1...6)
            .focused($isFocused)
            .padding(.vertical, 10)
            .accessibilityIdentifier("composer")
            .disabled(!enabled)
            if let onStop {
                YKIconButton(.stop, label: "Остановить", variant: .secondary, size: .md, iconWeight: .fill, action: onStop)
                    .accessibilityIdentifier("stop")
                    .disabled(!stopEnabled)
            }
            Group {
                Button(action: onSend) {
                    YKIcon(.arrowUp, size: 18)
                        .foregroundStyle(YKColorRole.onInk.color)
                        .frame(width: AgentChatMetrics.sendButtonSide, height: AgentChatMetrics.sendButtonSide)
                        .background(YKColorRole.ink.color, in: Circle())
                        .opacity(canSend ? 1 : 0.25)
                }
                .buttonStyle(.plain)
                .disabled(!canSend || !enabled)
                .accessibilityLabel(Text("Отправить"))
                .accessibilityIdentifier("send")
            }
        }
        .padding(.leading, YKTokens.Space.s5)
        .padding([.trailing, .vertical], YKTokens.Space.s2)
        .background(YKColorRole.surface2.color, in: RoundedRectangle(cornerRadius: AgentChatMetrics.composerRadius, style: .continuous))
        .onTapGesture { isFocused = true }
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
