import SwiftUI
import AgentChatClient
import YKDesign

public struct AgentChatModelPicker: View {
    let state: ChatExecutorModelState; let enabled: Bool; let showReasoning: Bool; let warning: String?; let onChange: (ChatExecutorModelChoice) -> Void
    @State private var pending: ChatExecutorModelChoice?
    public init(state: ChatExecutorModelState, enabled: Bool = true, showReasoning: Bool = false, warning: String? = "Первый ответ после смены модели может быть дороже и медленнее: обновляется кэш разговора.", onChange: @escaping (ChatExecutorModelChoice) -> Void) { self.state = state; self.enabled = enabled; self.showReasoning = showReasoning; self.warning = warning; self.onChange = onChange }
    public var body: some View {
        HStack(spacing: YKTokens.Space.s2) {
            Menu {
                ForEach(state.models) { model in
                    Button { let choice = ChatExecutorModelChoice(id: model.id); if model.id != state.selected.id { if warning == nil { onChange(choice) } else { pending = choice } } } label: { HStack { Text(model.label); if model.id == state.selected.id { YKIcon(.check, size: 14) } } }
                }
            } label: { HStack { Text(state.models.first(where: { $0.id == state.selected.id })?.label ?? state.selected.id).ykText(.small).lineLimit(1); YKIcon(.caretDown, size: 14) } }
            .accessibilityLabel("Модель").accessibilityValue(state.models.first(where: { $0.id == state.selected.id })?.label ?? state.selected.id).accessibilityIdentifier("executor-model")
            if showReasoning, let reasoning = state.models.first(where: { $0.id == state.selected.id })?.reasoning, !reasoning.levels.isEmpty {
                Menu { ForEach(reasoning.levels, id: \.self) { level in Button(level) { onChange(ChatExecutorModelChoice(id: state.selected.id, reasoning: level)) } } } label: { Text(state.selected.reasoning ?? reasoning.default ?? "Размышления").ykText(.small) }.accessibilityLabel("Сила размышления")
            }
        }.foregroundStyle(YKColorRole.text.color).disabled(!enabled || !state.canChange)
        .confirmationDialog("Сменить модель?", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible) {
            Button("Сменить") { if let choice = pending { pending = nil; onChange(choice) } }
            Button("Отмена", role: .cancel) { pending = nil }
        } message: { Text(warning ?? "") }
    }
}
