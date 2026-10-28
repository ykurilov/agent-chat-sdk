import SwiftUI
import AgentChatClient
import YKDesign

/// Optional composer control. Reuses the model picker confirmation and source-owned catalog.
public struct AgentChatComposerModelSelection {
    public let state: ChatExecutorModelState
    public let enabled: Bool
    public let showReasoning: Bool
    public let warning: String?
    public let onChange: (ChatExecutorModelChoice) -> Void

    public init(state: ChatExecutorModelState, enabled: Bool = true, showReasoning: Bool = false, warning: String? = "После изменения настроек первый ответ может быть дороже и медленнее: обновляется кэш разговора.", onChange: @escaping (ChatExecutorModelChoice) -> Void) {
        self.state = state; self.enabled = enabled; self.showReasoning = showReasoning
        self.warning = warning; self.onChange = onChange
    }
}

public struct AgentChatModelPicker: View {
    public enum Presentation { case standalone, composer }
    let presentation: Presentation
    private var selectedLabel: String { state.models.first(where: { $0.id == state.selected.id })?.label ?? state.selected.id }
    private var reasoningLabel: String? {
        state.selected.reasoning.map(levelLabel)
    }
    private func levelLabel(_ value: String) -> String {
        switch value.lowercased() {
        case "off", "none": return "Off"
        case "low": return "Low"
        case "medium": return "Medium"
        case "high": return "High"
        case "max": return "Max"
        default: return value.prefix(1).uppercased() + value.dropFirst()
        }
    }
    private var reasoning: ChatExecutorModel.Reasoning? {
        state.models.first(where: { $0.id == state.selected.id })?.reasoning
    }
    private func choose(_ choice: ChatExecutorModelChoice) {
        guard choice != state.selected else { return }
        if warning == nil { onChange(choice) } else { pending = choice }
    }
    @ViewBuilder private var reasoningChoices: some View {
        if let reasoning {
            ForEach(reasoning.levels, id: \.self) { level in
                Button {
                    let choice = ChatExecutorModelChoice(id: state.selected.id, reasoning: level)
                    if presentation == .composer { choose(choice) } else { onChange(choice) }
                } label: {
                    HStack { Text(levelLabel(level)); if level == state.selected.reasoning { YKIcon(.check, size: 14) } }
                }.accessibilityIdentifier("executor-reasoning-" + level)
            }
        }
    }
    let state: ChatExecutorModelState; let enabled: Bool; let showReasoning: Bool; let warning: String?; let onChange: (ChatExecutorModelChoice) -> Void
    @State private var pending: ChatExecutorModelChoice?
    public init(state: ChatExecutorModelState, enabled: Bool = true, showReasoning: Bool = false, warning: String? = "После изменения настроек первый ответ может быть дороже и медленнее: обновляется кэш разговора.", presentation: Presentation = .standalone, onChange: @escaping (ChatExecutorModelChoice) -> Void) { self.presentation = presentation; self.state = state; self.enabled = enabled; self.showReasoning = showReasoning; self.warning = warning; self.onChange = onChange }
    @State private var composerPresented = false
    @State private var showingModels = false

    private var pickerLabel: some View {
        HStack(spacing: YKTokens.Space.s1) {
            if presentation == .composer { YKIcon(.robot, size: 18) }
            Text(selectedLabel).ykText(.small).lineLimit(1)
            if presentation == .composer, let reasoningLabel {
                Text(reasoningLabel).ykText(.small).foregroundStyle(YKColorRole.muted.color).lineLimit(1)
            }
            YKIcon(.caretDown, size: 12)
        }.frame(minHeight: presentation == .composer ? 40 : 0)
    }

    private func confirming<Content: View>(_ content: Content) -> some View {
        content.confirmationDialog(pending?.id == state.selected.id ? "Сменить уровень размышлений?" : "Сменить модель?", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            Button("Сменить") {
                if let choice = pending {
                    guard enabled, state.canChange else { pending = nil; composerPresented = false; return }
                    pending = nil
                    composerPresented = false
                    onChange(choice)
                }
            }
            if presentation == .composer {
                // Native popover confirmations omit role: .cancel actions; keep an explicit exit.
                Button("Отмена") { pending = nil }
            } else {
                Button("Отмена", role: .cancel) { pending = nil }
            }
        } message: { Text(warning ?? "") }
    }

    private func composerChoice(_ choice: ChatExecutorModelChoice) {
        guard enabled, state.canChange else { return }
        if warning == nil, choice != state.selected { composerPresented = false }
        choose(choice)
    }

    private func choiceLabel(_ title: String, selected: Bool) -> some View {
        HStack {
            Text(title).ykText(.small)
            Spacer(minLength: YKTokens.Space.s2)
            if selected { YKIcon(.check, size: 14) }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    // These remain real SwiftUI buttons rather than native Menu actions, whose
    // UIKit projection can discard accessibilityIdentifier and reverse the order.
    private var composerMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showingModels {
                Button { showingModels = false } label: {
                    HStack {
                        YKIcon(.caretDown, size: 12).rotationEffect(.degrees(90))
                        Text("Настройки модели").ykText(.small)
                        Spacer()
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.accessibilityIdentifier("executor-models-back")
                Divider()
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(state.models) { model in
                            Button { if model.id != state.selected.id { composerChoice(ChatExecutorModelChoice(id: model.id)) } } label: {
                                choiceLabel(model.label, selected: model.id == state.selected.id)
                            }
                            .accessibilityLabel(model.label)
                            .accessibilityIdentifier("executor-model-" + model.id)
                        }
                    }
                }.frame(height: min(CGFloat(state.models.count) * 44, 352))
            } else {
                Button { showingModels = true } label: {
                    HStack {
                        Text("Модель: " + selectedLabel).ykText(.small).lineLimit(2)
                        Spacer(minLength: YKTokens.Space.s2)
                        YKIcon(.caretDown, size: 12).rotationEffect(.degrees(-90))
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Модель: " + selectedLabel)
                .accessibilityIdentifier("executor-models")
                if showReasoning, let reasoning, !reasoning.levels.isEmpty {
                    Divider()
                    Text("Уровень размышлений").ykText(.small)
                        .foregroundStyle(YKColorRole.muted.color)
                        .padding(.vertical, YKTokens.Space.s2)
                        .accessibilityIdentifier("executor-reasoning")
                    ForEach(reasoning.levels, id: \.self) { level in
                        Button { composerChoice(ChatExecutorModelChoice(id: state.selected.id, reasoning: level)) } label: {
                            choiceLabel(levelLabel(level), selected: level == state.selected.reasoning)
                        }
                        .accessibilityLabel(levelLabel(level))
                        .accessibilityIdentifier("executor-reasoning-" + level)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(YKColorRole.text.color)
        .padding(YKTokens.Space.s3)
        .frame(width: 300)
        .disabled(!enabled || !state.canChange)
    }

    public var body: some View {
        Group {
            if presentation == .composer {
                Button { showingModels = false; composerPresented = true } label: { pickerLabel }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Модель")
                    .accessibilityValue([selectedLabel, reasoningLabel].compactMap { $0 }.joined(separator: " "))
                    .accessibilityIdentifier("executor-model")
                    .popover(isPresented: $composerPresented) {
                        confirming(composerMenu)
                            .presentationBackground(YKColorRole.surface.color)
                            .presentationCompactAdaptation(.popover)
                    }
            } else {
                confirming(HStack(spacing: YKTokens.Space.s2) {
                    Menu {
                        ForEach(state.models) { model in
                            Button { if model.id != state.selected.id { choose(ChatExecutorModelChoice(id: model.id)) } } label: {
                                HStack { Text(model.label); if model.id == state.selected.id { YKIcon(.check, size: 14) } }
                            }
                        }
                    } label: { pickerLabel }
                    .accessibilityLabel("Модель").accessibilityValue(selectedLabel).accessibilityIdentifier("executor-model")
                    if showReasoning, let reasoning, !reasoning.levels.isEmpty {
                        Menu { reasoningChoices } label: { Text(levelLabel(state.selected.reasoning ?? reasoning.default ?? "Размышления")).ykText(.small) }
                            .accessibilityLabel("Сила размышления").accessibilityIdentifier("executor-reasoning")
                    }
                })
            }
        }
        .foregroundStyle(YKColorRole.text.color)
        .disabled(!enabled || !state.canChange)
        .onChange(of: enabled && state.canChange) { _, allowed in
            if !allowed { pending = nil; composerPresented = false }
        }
    }
}
