import SwiftUI
import AgentChatClient
import YKDesign

/// UI state belongs to this screen; transport, cursor and durable commands belong to AgentChatClient.
@MainActor @Observable public final class AgentChatScreenModel {
    public private(set) var state = ChatClientState()
    public private(set) var draft = ""
    public private(set) var loadingDraft = false
    public private(set) var submitting = false
    public private(set) var failure: String?
    private let client: AgentChatClient
    @ObservationIgnored nonisolated(unsafe) private var observation: Task<Void, Never>?
    private var draftWrites: Task<Void, Never>?
    public init(client: AgentChatClient) { self.client = client }
    public func connect() async {
        if observation == nil {
            observation = Task { [weak self, client] in
                for await value in await client.updates() {
                    guard let self else { return }
                    let switched = state.selectedChatId != value.selectedChatId
                    if switched { loadingDraft = true }
                    state = value
                    if switched, let id = value.selectedChatId { draft = await client.draft(chatId: id) }
                    if switched { loadingDraft = false }
                }
            }
        }
        await client.connect()
    }
    public func disconnect() async { await client.disconnect() }
    public func select(_ id: String) async {
        await draftWrites?.value
        await client.openConversation(id)
    }
    public func editDraft(_ text: String, chatId: String?) {
        guard !loadingDraft, let id = chatId, id == state.selectedChatId else { return }
        draft = text
        let prior = draftWrites
        draftWrites = Task { [weak self, client] in
            await prior?.value
            do { try await client.setDraft(text, chatId: id) }
            catch { self?.failure = "Не удалось сохранить черновик" }
        }
    }
    public func send() async {
        guard !submitting, let id = state.selectedChatId else { return }
        submitting = true; defer { submitting = false }
        let text = draft
        await draftWrites?.value
        do { try await client.send(text, chatId: id); if state.selectedChatId == id, draft == text { draft = "" }; failure = nil }
        catch { failure = "Сообщение осталось в поле ввода: запись не удалась" }
    }
    public func answer(_ id: String, _ decision: PermissionDecision) async {
        guard let chat = state.selectedChatId else { return }
        do { try await client.answer(id, chatId: chat, decision: decision); failure = nil }
        catch { failure = "Ответ на запрос не сохранён" }
    }
    public func stop() async {
        guard let id = state.selectedChatId else { return }
        do { try await client.stop(chatId: id); failure = nil }
        catch { failure = "Остановка не подтверждена. Проверьте связь" }
    }
    public func retry() async { await client.retryPending(); await client.connect() }
    deinit { observation?.cancel() }
}

/// Native Oduvanchik shell. Authentication and selection of executor bindings stay with the host app.
public struct AgentChatView: View {
    @State private var model: AgentChatScreenModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection: String?
    public init(client: AgentChatClient) { _model = State(initialValue: AgentChatScreenModel(client: client)) }
    public var body: some View {
        NavigationSplitView {
            List(model.state.conversations, selection: $selection) { chat in
                NavigationLink(value: chat.id) {
                    HStack {
                        Text(chat.title).ykText(.body).foregroundStyle(YKTokens.Colors.text)
                        if chat.pinned { Spacer(); Text("Главный").ykText(.small).foregroundStyle(YKTokens.Colors.muted) }
                    }
                }
            }.navigationTitle("Беседы")
        } detail: {
            VStack(spacing: 0) {
                connection
                if let snapshot = model.state.snapshot, snapshot.conversation.id == selection {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: YKTokens.Space.s4) {
                                ForEach(snapshot.messages) { message in messageRow(message).id(message.id) }
                                ForEach(snapshot.permissions.filter { $0.status != "resolved" }) { permission in
                                    PermissionCard(permission: permission) { decision in Task { await model.answer(permission.id, decision) } }
                                }
                                if let error = snapshot.turn.error { Text(error).ykText(.small).foregroundStyle(YKTokens.Colors.danger) }
                            }.padding(YKTokens.Space.s4)
                        }.onChange(of: snapshot.cursor) { _, _ in
                            if let id = snapshot.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
                        }
                    }
                } else { Text("Выберите беседу").ykText(.body).foregroundStyle(YKTokens.Colors.muted).frame(maxWidth: .infinity, maxHeight: .infinity) }
                if let failure = model.failure { Text(failure).ykText(.small).foregroundStyle(YKTokens.Colors.danger).padding(YKTokens.Space.s3) }
                composer
            }.background(YKTokens.Colors.bg)
                .navigationTitle(model.state.snapshot?.conversation.title ?? "Чат")
        }
        .onChange(of: model.state.selectedChatId) { _, id in if let id, selection != id { selection = id } }
        .onChange(of: selection) { _, id in if let id, id != model.state.selectedChatId { Task { await model.select(id) } } }
        .task { await model.connect() }
        .onDisappear { Task { await model.disconnect() } }
        .onChange(of: scenePhase) { _, phase in Task { if phase == .active { await model.connect() } else if phase == .background { await model.disconnect() } } }
    }
    private var connection: some View {
        HStack(spacing: YKTokens.Space.s2) {
            Text(connectionLabel).ykText(.small).foregroundStyle(YKTokens.Colors.muted)
            Spacer()
            if model.state.network == .reconnecting || model.state.network == .disconnected || model.state.pending.contains(where: { $0.error != nil }) {
                Button("Повторить связь") { Task { await model.retry() } }.buttonStyle(.yk(.ghost))
            }
        }.padding(.horizontal, YKTokens.Space.s4).padding(.vertical, YKTokens.Space.s2)
    }
    private var connectionLabel: String {
        switch model.state.network {
        case .unauthorized: "Требуется вход"
        case .connecting: "Подключение…"
        case .reconnecting, .disconnected: "Нет связи. Сообщения сохраняются на устройстве"
        case .connected:
            model.state.snapshot?.conversation.connection == "offline" ? "Исполнитель недоступен. Сообщения ждут отправки" : "На связи"
        }
    }
    private func messageRow(_ message: ChatMessage) -> some View {
        HStack(alignment: .top) {
            if message.role == "user" { Spacer(minLength: YKTokens.Space.s8) }
            VStack(alignment: .leading, spacing: YKTokens.Space.s2) {
                Text(message.role == "user" ? "Вы" : message.role == "system" ? "Система" : "Агент").ykText(.small).foregroundStyle(YKTokens.Colors.muted)
                Text(message.text).ykText(.body).textSelection(.enabled).foregroundStyle(YKTokens.Colors.text)
                if let delivery = message.delivery, delivery != "sent" {
                    Text(delivery == "refused" ? "Отправка отклонена, текст сохранён" : delivery == "unknown" ? "Проверяем доставку" : "Ожидает отправки").ykText(.small).foregroundStyle(YKTokens.Colors.muted)
                }
                if message.status == "streaming" { YKSphere(size: 16) }
                if ["stopped", "error", "unknown"].contains(message.status) {
                    Text(message.status == "stopped" ? "Остановлено" : message.status == "error" ? "Ответ прерван" : "Итог хода уточняется").ykText(.small).foregroundStyle(YKTokens.Colors.muted)
                }
            }.padding(YKTokens.Space.s4).background(message.role == "user" ? YKTokens.Colors.surface2 : YKTokens.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: YKTokens.Radius.message))
            if message.role != "user" { Spacer(minLength: YKTokens.Space.s8) }
        }
    }
    private var composer: some View {
        HStack(alignment: .bottom, spacing: YKTokens.Space.s2) {
            TextField("Сообщение", text: Binding(get: { model.draft }, set: { model.editDraft($0, chatId: selection) }), axis: .vertical)
                .lineLimit(1...8).ykText(.body).padding(YKTokens.Space.s3)
                .background(YKTokens.Colors.surface).clipShape(RoundedRectangle(cornerRadius: YKTokens.Radius.composer))
                .overlay(RoundedRectangle(cornerRadius: YKTokens.Radius.composer).stroke(YKTokens.Colors.border))
                .disabled(model.submitting || model.state.selectedChatId == nil || model.state.snapshot?.conversation.execution.kind == "model")
            VStack(spacing: YKTokens.Space.s2) {
                if model.state.snapshot?.turn.status == "running" {
                    Button("Стоп") { Task { await model.stop() } }.buttonStyle(.yk(.secondary))
                        .disabled(model.state.snapshot?.turn.stopRequested == true || model.state.snapshot?.conversation.connection == "offline" || model.state.network != .connected)
                }
                Button("Отправить") { Task { await model.send() } }.buttonStyle(.yk(.primary))
                    .disabled(model.submitting || model.state.selectedChatId == nil || model.state.snapshot?.conversation.execution.kind == "model" || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(YKTokens.Space.s4)
            .disabled(model.loadingDraft || selection == nil || selection != model.state.selectedChatId)
    }
}

private struct PermissionCard: View {
    let permission: ChatPermission
    let answer: (PermissionDecision) -> Void
    @State private var answers: [String: String] = [:]
    private var questions: [JSONValue] { permission.input?["questions"]?.array ?? [] }
    private func renderInput(_ input: [String: JSONValue]) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(input), let text = String(data: data, encoding: .utf8) else { return "Параметры недоступны" }
        return text
    }
    var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s3) {
            Text(permission.title ?? permission.name).ykText(.heading)
            if let description = permission.description { Text(description).ykText(.body).textSelection(.enabled) }
            if questions.isEmpty, let input = permission.input, !input.isEmpty {
                ScrollView {
                    Text(renderInput(input)).ykText(.small).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.frame(maxHeight: 240)
                    .accessibilityLabel("Параметры запроса")
            }
            if permission.status == "responding" { Text("Ответ сохранён, ожидаем подтверждения").ykText(.small) }
            else if !questions.isEmpty {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, question in
                    if let text = question["question"]?.string {
                        Text(text).ykText(.body)
                        ForEach(Array((question["options"]?.array ?? []).enumerated()), id: \.offset) { _, option in
                            if let label = option["label"]?.string {
                                Button(label) { answers[text] = label }.buttonStyle(.yk(.secondary))
                            }
                        }
                        YKTextField(placeholder: "Ваш ответ", text: Binding(get: { answers[text] ?? "" }, set: { answers[text] = $0 }))
                    }
                }
                Button("Ответить") { answer(PermissionDecision(answers: answers)) }.buttonStyle(.yk(.primary))
                    .disabled(questions.contains { q in q["question"]?.string.map { (answers[$0] ?? "").isEmpty } ?? true })
            } else if let actions = permission.actions, !actions.isEmpty {
                ForEach(actions) { action in Button(action.label) { answer(PermissionDecision(actionId: action.id)) }.buttonStyle(.yk(.secondary)) }
            } else {
                HStack {
                    Button("Разрешить") { answer(PermissionDecision(behavior: "allow")) }.buttonStyle(.yk(.primary))
                    Button("Отказать") { answer(PermissionDecision(behavior: "deny")) }.buttonStyle(.yk(.secondary))
                }
            }
        }.padding(YKTokens.Space.s4).background(YKTokens.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: YKTokens.Radius.message))
            .overlay(RoundedRectangle(cornerRadius: YKTokens.Radius.message).stroke(YKTokens.Colors.border))
    }
}
