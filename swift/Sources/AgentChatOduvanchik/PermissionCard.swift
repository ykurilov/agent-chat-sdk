import SwiftUI
import AgentChatClient
import YKDesign

/// A permission is a timeline entity, including its actual external answer after resolution.
public struct AgentChatPermissionCard: View {
    public let permission: ChatPermission
    private let answer: (PermissionDecision) -> Void
    @State private var answers: [String: String] = [:]
    public init(permission: ChatPermission, answer: @escaping (PermissionDecision) -> Void) { self.permission = permission; self.answer = answer }
    private var questions: [JSONValue] { permission.input?["questions"]?.array ?? [] }
    public var body: some View {
        YKCard(spacing: YKTokens.Space.s3) {
            HStack {
                if permission.status == "open" { YKNewDot() }
                Text(permission.name).ykMonoLabel(color: permission.status == "open" ? .accentText : .muted)
                Spacer()
                if let date = permission.createdAt.flatMap(parseDate) {
                    Text(date, style: .time).ykText(.small).foregroundStyle(YKColorRole.muted.color)
                }
            }
            AgentChatMarkdown(permission.title ?? permission.description ?? permission.name)
            if let description = permission.description, permission.title != nil, description != permission.title { AgentChatMarkdown(description) }
            if questions.isEmpty, let input = permission.input, !input.isEmpty {
                ScrollView { AgentChatMarkdown("```json\n" + render(input) + "\n```") }.frame(maxHeight: 240)
                    .accessibilityLabel("Параметры запроса")
            }
            if permission.status == "resolved" {
                YKChip(PermissionPresentation.answerLabel(permission), kind: permission.resolution?.behavior == "allow" ? .success : .neutral)
                if let values = permission.resolution?.updatedInput?["answers"], case .object(let object) = values {
                    ForEach(object.keys.sorted(), id: \.self) { key in
                        Text(key).ykText(.small).foregroundStyle(YKColorRole.muted.color)
                        Text(PermissionPresentation.text(object[key]!)).ykText(.body).textSelection(.enabled)
                    }
                }
                if let message = permission.resolution?.message, !message.isEmpty { AgentChatMarkdown(message) }
            } else if permission.status == "responding" {
                Text("Ответ сохранён, ожидаем подтверждения").ykText(.small).foregroundStyle(YKColorRole.muted.color)
            } else if !questions.isEmpty {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, question in
                    if let text = question["question"]?.string {
                        AgentChatMarkdown(text)
                        ForEach(Array((question["options"]?.array ?? []).enumerated()), id: \.offset) { _, option in
                            if let label = option["label"]?.string {
                                Button { answers[text] = label } label: {
                                    HStack { Text(label); if answers[text] == label { YKIcon(.check, size: 16) } }
                                }.buttonStyle(.yk(.secondary))
                            }
                        }
                        YKTextField(placeholder: "Ваш ответ", text: Binding(get: { answers[text] ?? "" }, set: { answers[text] = $0 }))
                    }
                }
                HStack {
                    Button("Ответить") { answer(PermissionDecision(answers: answers)) }.buttonStyle(.yk(.primary))
                        .disabled(questions.contains { q in q["question"]?.string.map { (answers[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } ?? true })
                    if let deny = permission.actions?.first(where: { $0.behavior == "deny" }) {
                        Button(deny.label) { answer(PermissionDecision(actionId: deny.id)) }.buttonStyle(.yk(.secondary))
                    } else if permission.actions?.isEmpty != false {
                        Button("Отказать") { answer(PermissionDecision(behavior: "deny")) }.buttonStyle(.yk(.secondary))
                    }
                }
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: YKTokens.Space.s2) { actionButtons }
                    VStack(spacing: YKTokens.Space.s2) { actionButtons }
                }
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("permission:" + permission.id)
    }
    @ViewBuilder private var actionButtons: some View {
        if let actions = permission.actions, !actions.isEmpty {
            ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                Button(action.label) { answer(PermissionDecision(actionId: action.id)) }
                    .buttonStyle(.yk(index == 0 ? .primary : .secondary, size: .lg))
            }
        } else {
            Button("Разрешить") { answer(PermissionDecision(behavior: "allow")) }.buttonStyle(.yk(.primary, size: .lg))
            Button("Отказать") { answer(PermissionDecision(behavior: "deny")) }.buttonStyle(.yk(.secondary, size: .lg))
        }
    }
    private func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    private func render(_ input: [String: JSONValue]) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(input), let text = String(data: data, encoding: .utf8) else { return "Параметры недоступны" }
        return text
    }
}
