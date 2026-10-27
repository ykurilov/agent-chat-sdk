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
    public var body: some View {
        HStack(spacing: YKTokens.Space.s2) {
            Menu {
                ForEach(state.models) { model in
                    Button { if model.id != state.selected.id { choose(ChatExecutorModelChoice(id: model.id)) } } label: { HStack { Text(model.label); if model.id == state.selected.id { YKIcon(.check, size: 14) } } }
                }
                if presentation == .composer, showReasoning, let reasoning, !reasoning.levels.isEmpty {
                    Section("Уровень размышлений") { reasoningChoices }
                        .accessibilityIdentifier("executor-reasoning")
                }
            } label: {
                HStack(spacing: YKTokens.Space.s1) {
                    if presentation == .composer { YKIcon(.robot, size: 18) }
                    Text(selectedLabel).ykText(.small).lineLimit(1)
                    if presentation == .composer, let reasoningLabel {
                        Text(reasoningLabel).ykText(.small).foregroundStyle(YKColorRole.muted.color).lineLimit(1)
                    }
                    YKIcon(.caretDown, size: 12)
                }.frame(minHeight: presentation == .composer ? 40 : 0)
            }
            .accessibilityLabel("Модель").accessibilityValue(presentation == .composer ? [selectedLabel, reasoningLabel].compactMap { $0 }.joined(separator: " ") : selectedLabel).accessibilityIdentifier("executor-model")
            if presentation == .standalone, showReasoning, let reasoning, !reasoning.levels.isEmpty {
                Menu { reasoningChoices } label: { Text(levelLabel(state.selected.reasoning ?? reasoning.default ?? "Размышления")).ykText(.small) }
                    .accessibilityLabel("Сила размышления").accessibilityIdentifier("executor-reasoning")
            }
        }.foregroundStyle(YKColorRole.text.color).disabled(!enabled || !state.canChange)
        .confirmationDialog(pending?.id == state.selected.id ? "Сменить уровень размышлений?" : "Сменить модель?", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            Button("Сменить") { if let choice = pending { pending = nil; onChange(choice) } }
            Button("Отмена", role: .cancel) { pending = nil }
        } message: { Text(warning ?? "") }
    }
}
