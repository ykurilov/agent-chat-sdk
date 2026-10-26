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

/// Shared native screen; applications can also compose the exported parts around the screen model.
public struct AgentChatView: View {
    @State private var model: AgentChatScreenModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection: String?
    private let responderName: String
    public init(client: AgentChatClient, responderName: String = "Агент") {
        _model = State(initialValue: AgentChatScreenModel(client: client)); self.responderName = responderName
    }
    public var body: some View {
        NavigationSplitView {
            List(model.state.conversations, selection: $selection) { chat in
                NavigationLink(value: chat.id) {
                    HStack {
                        Text(chat.title).ykText(.body).foregroundStyle(YKColorRole.text.color)
                        if chat.pinned { Spacer(); Text("Главный").ykText(.small).foregroundStyle(YKColorRole.muted.color) }
                    }
                }
            }.navigationTitle("Беседы")
        } detail: {
            VStack(spacing: 0) {
                AgentChatHeader(model.state.snapshot?.conversation.title ?? "Чат", status: executorStatus, statusKind: executorStatusKind) {
                    EmptyView()
                } subtitle: { AgentChatResponderLabel(responderName) }
                connection
                if let snapshot = model.state.snapshot, snapshot.conversation.id == selection {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: AgentChatMetrics.replySpacing) {
                                ForEach(snapshot.timeline) { entry in
                                    switch entry {
                                    case .message(let message): messageRow(message).id(entry.id)
                                    case .permission(let permission):
                                        AgentChatPermissionCard(permission: permission) { decision in Task { await model.answer(permission.id, decision) } }.id(entry.id)
                                    }
                                }
                                if snapshot.turn.status == "running", snapshot.messages.last?.status != "streaming", !snapshot.permissions.contains(where: { $0.status != "resolved" }) {
                                    AgentChatThinkingRow("Готовит ответ")
                                }
                                if let error = snapshot.turn.error { Text(error).ykText(.small).foregroundStyle(YKColorRole.danger.color) }
                            }.padding(.horizontal, AgentChatMetrics.columnPadding).padding(.vertical, YKTokens.Space.s4)
                        }.onChange(of: snapshot.cursor) { _, _ in
                            if let id = snapshot.timeline.last?.id { proxy.scrollTo(id, anchor: .bottom) }
                        }
                    }
                } else {
                    Text("Выберите беседу").ykText(.body).foregroundStyle(YKColorRole.muted.color).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if let failure = model.failure { Text(failure).ykText(.small).foregroundStyle(YKColorRole.danger.color).padding(YKTokens.Space.s3) }
                composer
            }.background(YKColorRole.bg.color).navigationTitle("")
        }
        .tint(YKColorRole.accentText.color)
        .onChange(of: model.state.selectedChatId) { _, id in if let id, selection != id { selection = id } }
        .onChange(of: selection) { _, id in if let id, id != model.state.selectedChatId { Task { await model.select(id) } } }
        .task { await model.connect() }
        .onDisappear { Task { await model.disconnect() } }
        .onChange(of: scenePhase) { _, phase in Task { if phase == .active { await model.connect() } else if phase == .background { await model.disconnect() } } }
    }
    private var executorStatus: String {
        guard model.state.network == .connected else { return model.state.network == .unauthorized ? "Нужен вход" : "Нет связи" }
        switch model.state.snapshot?.conversation.connection {
        case "thinking": return "Думает"
        case "waiting_approval": return "Ждёт ответа"
        case "idle": return "На связи"
        default: return "Недоступен"
        }
    }
    private var executorStatusKind: YKChipKind {
        guard model.state.network == .connected else { return .neutral }
        switch model.state.snapshot?.conversation.connection {
        case "thinking", "waiting_approval": return .live
        case "idle": return .success
        default: return .neutral
        }
    }
    private var connection: some View {
        HStack(spacing: YKTokens.Space.s2) {
            if model.state.network != .connected || model.state.snapshot?.conversation.connection == "offline" {
                Text(connectionLabel).ykText(.small).foregroundStyle(YKColorRole.muted.color)
            }
            Spacer()
            if model.state.network == .reconnecting || model.state.network == .disconnected || model.state.pending.contains(where: { $0.error != nil }) {
                Button("Повторить связь") { Task { await model.retry() } }.buttonStyle(.yk(.ghost))
            }
        }.padding(.horizontal, AgentChatMetrics.columnPadding)
    }
    private var connectionLabel: String {
        switch model.state.network {
        case .unauthorized: "Требуется вход"
        case .connecting: "Подключение…"
        case .reconnecting, .disconnected: "Нет связи. Сообщения сохраняются на устройстве"
        case .connected: "Исполнитель недоступен. Сообщения ждут отправки"
        }
    }
    @ViewBuilder private func messageRow(_ message: ChatMessage) -> some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: YKTokens.Space.s2) {
            if message.role == "user" { AgentChatUserBubble(message.text) }
            else { AgentChatMarkdown(message.text) }
            if let delivery = message.delivery, delivery != "sent" {
                AgentChatDeliveryNote(delivery == "refused" ? "Отправка отклонена, текст сохранён" : delivery == "unknown" ? "Проверяем доставку" : delivery == "sending" ? "Отправляем" : "Ожидает отправки", kind: delivery == "refused" ? .failed : .sending)
            }
            if message.status == "streaming", model.state.snapshot?.conversation.connection == "thinking" { AgentChatThinkingRow("Пишет ответ") }
            if ["stopped", "error", "unknown"].contains(message.status) {
                Text(message.status == "stopped" ? "Остановлено" : message.status == "error" ? "Ответ прерван" : "Итог хода уточняется").ykText(.small).foregroundStyle(YKColorRole.muted.color)
            }
        }.frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }
    private var composer: some View {
        AgentChatComposer(text: Binding(get: { model.draft }, set: { model.editDraft($0, chatId: selection) }), placeholder: "Сообщение", onStop: model.state.snapshot?.turn.status == "running" ? { Task { await model.stop() } } : nil, enabled: !model.submitting && model.state.snapshot?.conversation.execution.kind != "model", stopEnabled: model.state.snapshot?.turn.stopRequested != true && model.state.snapshot?.conversation.connection != "offline" && model.state.network == .connected) {
            Task { await model.send() }
        }.padding(YKTokens.Space.s4)
            .disabled(model.loadingDraft || selection == nil || selection != model.state.selectedChatId)
    }
}
