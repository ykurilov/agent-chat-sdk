// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { JournalModelRowView, JournalToolRowView, PeopleChatsView, SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { russianChatReopenLabels, russianPeopleChatsLabels, russianSandboxLabels as labels } from "@ykurilov/agent-chat-sandbox/react";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TandemAgentMessage } from "../src/agent-message";
import { tandemSandboxSkin } from "../src/sandbox";
import { TandemToolCallRow } from "../src/tool-call-row";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const skin: SandboxSkin = tandemSandboxSkin;

function stubScreen(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

const modelRow = (patch: Partial<JournalModelRowView> = {}): JournalModelRowView => ({
  kind: "model",
  id: "m1",
  purpose: "answer",
  attempt: 1,
  modelId: "gpt-x",
  status: "complete",
  time: "10:00:01",
  durationMs: 1200,
  firstChunkMs: 300,
  inputTokens: 100,
  cachedInputTokens: 40,
  outputTokens: 20,
  cost: "$0.0010",
  instructionsChanged: false,
  open: false,
  onOpenChange: vi.fn(),
  ...patch,
});
const toolRow = (patch: Partial<JournalToolRowView> = {}): JournalToolRowView => ({
  kind: "tool",
  id: "t1",
  toolName: "search",
  source: "server",
  status: "complete",
  time: "10:00:02",
  durationMs: 50,
  outputEdited: false,
  open: false,
  onOpenChange: vi.fn(),
  ...patch,
});

type JournalListProps = ComponentProps<SandboxSkin["JournalList"]>;
const renderJournal = (props: Partial<JournalListProps> = {}) =>
  render(
    <skin.JournalList
      state="ready"
      rows={[]}
      turns={[
        { id: null, label: labels.wholeChat },
        { id: "a1", label: labels.turnLabel(1) },
      ]}
      currentTurnId={null}
      onTurnChange={vi.fn()}
      {...props}
    />,
  );

describe("Тандем: каркас песочницы", () => {
  const layout = (journalOpen: boolean, onJournalOpenChange = vi.fn()) =>
    render(
      <skin.SandboxLayout
        header={<div>шапка</div>}
        chat={<div>чат</div>}
        journal={<div>журнал</div>}
        journalOpen={journalOpen}
        onJournalOpenChange={onJournalOpenChange}
      />,
    );

  it("широкий экран: чат и журнал рядом, панели подписаны", () => {
    stubScreen(true);
    layout(false);
    expect(within(screen.getByRole("region", { name: labels.chatPanel })).getByText("чат")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: labels.journalPanel })).getByText("журнал")).toBeTruthy();
    expect(screen.getByText("шапка")).toBeTruthy();
  });

  it("узкий экран: журнал спрятан, кнопка открывает выдвижную панель", () => {
    stubScreen(false);
    const onOpen = vi.fn();
    const { rerender } = layout(false, onOpen);
    expect(screen.queryByText("журнал")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: labels.openJournal }));
    expect(onOpen).toHaveBeenCalledWith(true);
    rerender(
      <skin.SandboxLayout header={null} chat={<div>чат</div>} journal={<div>журнал</div>} journalOpen onJournalOpenChange={onOpen} />,
    );
    expect(within(screen.getByRole("dialog", { name: labels.journalPanel })).getByText("журнал")).toBeTruthy();
  });
});

describe("Тандем: список журнала", () => {
  it("состояния: загрузка, ошибка с повтором, пусто", () => {
    const onRetry = vi.fn();
    const { rerender } = renderJournal({ state: "loading" });
    expect(screen.getByText(labels.journalLoading)).toBeTruthy();
    rerender(<skin.JournalList state="failed" rows={[]} onRetry={onRetry} turns={[]} currentTurnId={null} onTurnChange={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain(labels.journalFailed);
    fireEvent.click(screen.getByRole("button", { name: labels.retry }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<skin.JournalList state="empty" rows={[]} turns={[]} currentTurnId={null} onTurnChange={vi.fn()} />);
    expect(screen.getByText(labels.journalEmpty)).toBeTruthy();
  });

  it("выбор хода: «весь чат» отдаёт null", () => {
    const onTurnChange = vi.fn();
    renderJournal({ onTurnChange, currentTurnId: "a1" });
    // список ходов подписан отдельно от панели журнала
    const select = screen.getByRole("combobox", { name: labels.turnPicker });
    expect(labels.turnPicker).not.toBe(labels.journalPanel);
    fireEvent.change(select, { target: { value: "" } });
    expect(onTurnChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(select, { target: { value: "a1" } });
    expect(onTurnChange).toHaveBeenLastCalledWith("a1");
  });

  it("строка обращения: модель, назначение, цена, токены; раскрывается кнопкой с aria-expanded", () => {
    const onOpenChange = vi.fn();
    renderJournal({ rows: [modelRow({ onOpenChange, instructionsChanged: true })] });
    const toggle = screen.getByRole("button", { name: /gpt-x/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain(labels.purposes.answer);
    expect(toggle.textContent).toContain("$0.0010");
    expect(screen.getByText(labels.instructionsChanged)).toBeTruthy();
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("раскрытая строка показывает подробности; цена неизвестна — надпись", () => {
    renderJournal({ rows: [modelRow({ open: true, cost: undefined, details: <div>подробности</div> })] });
    expect(screen.getByRole("button", { name: /gpt-x/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("подробности")).toBeTruthy();
    expect(screen.getByText(labels.costUnknown)).toBeTruthy();
  });

  it("строка вызова: отметки «из сообщения» и «результат изменён»", () => {
    renderJournal({ rows: [toolRow({ source: "message", outputEdited: true, title: "Поиск" })] });
    expect(screen.getByRole("button", { name: /Поиск/ })).toBeTruthy();
    expect(screen.getByText(labels.fromMessage)).toBeTruthy();
    expect(screen.getByText(labels.outputEdited)).toBeTruthy();
  });
});

describe("Тандем: подробности", () => {
  it("обращение к модели: инструкция, сообщения с отметкой «новое», ответ", () => {
    render(
      <skin.ModelCallDetails
        state="ready"
        instructions="Будь краток"
        messages={[
          { role: "user", content: "старое", isNew: false, truncated: false },
          { role: "user", content: "свежее", isNew: true, truncated: true },
        ]}
        tools={[{ name: "search", description: "Ищет", inputSchema: "{}" }]}
        settings="{}"
        response={{ text: "Готово", reasoning: "", toolCalls: [{ toolCallId: "s1", toolName: "search", input: '{"q":1}' }], finishReason: "stop" }}
        error={null}
      />,
    );
    expect(screen.getByText("Будь краток")).toBeTruthy();
    expect(screen.getAllByText(labels.newMessage)).toHaveLength(1);
    expect(screen.getByText(labels.truncated)).toBeTruthy();
    expect(screen.getByText("Готово")).toBeTruthy();
    expect(screen.getByText("stop")).toBeTruthy();
  });

  it("подробности не загрузились — повтор", () => {
    const onRetry = vi.fn();
    render(<skin.ToolCallDetails state="failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: labels.retry }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("вызов инструмента: вход, результата нет", () => {
    render(<skin.ToolCallDetails state="ready" input='{"q":1}' output={null} error={null} truncated={false} />);
    expect(screen.getByText('{"q":1}')).toBeTruthy();
    expect(screen.getByText(labels.noOutput)).toBeTruthy();
  });
});

describe("Тандем: редактор инструкции", () => {
  type Props = ComponentProps<SandboxSkin["InstructionEditor"]>;
  const editor = (props: Partial<Props> = {}) =>
    render(
      <skin.InstructionEditor
        value="Текст"
        onValueChange={vi.fn()}
        appInstructions="Боевая"
        edited={false}
        dirty={false}
        onSave={vi.fn()}
        canSave={false}
        saving={false}
        open
        onOpenChange={vi.fn()}
        maxLength={100}
        {...props}
      />,
    );

  it("поле подписано, правка уходит в onValueChange, сохранение по canSave", () => {
    const onValueChange = vi.fn();
    const onSave = vi.fn();
    editor({ onValueChange, onSave, canSave: true, dirty: true });
    fireEvent.change(screen.getByLabelText(labels.instructionText), { target: { value: "Новое" } });
    expect(onValueChange).toHaveBeenCalledWith("Новое");
    fireEvent.click(screen.getByRole("button", { name: labels.instructionsSave }));
    expect(onSave).toHaveBeenCalled();
    expect(screen.getByText("Боевая")).toBeTruthy();
  });

  it("правленая инструкция: отметка и «вернуть боевую»; ошибка — alert", () => {
    const onReset = vi.fn();
    editor({ edited: true, onReset, error: labels.instructionsSaveFailed });
    expect(screen.getByText(labels.instructionsEdited)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: labels.instructionsReset }));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(labels.instructionsSaveFailed);
    expect((screen.getByRole("button", { name: labels.instructionsSave }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("свёрнутый редактор: только заголовок-кнопка с aria-expanded", () => {
    const onOpenChange = vi.fn();
    editor({ open: false, onOpenChange });
    expect(screen.queryByLabelText(labels.instructionText)).toBeNull();
    const toggle = screen.getByRole("button", { name: new RegExp(labels.instructionEditor) });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // aria-controls всегда указывает на существующий элемент, в свёрнутом виде он скрыт
    const body = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(body).not.toBeNull();
    expect(body!.hidden).toBe(true);
  });
});

describe("Тандем: редактор ответа", () => {
  it("текст и JSON результата подписаны; ошибки видны; сохранение и отмена", () => {
    const onTextChange = vi.fn();
    const onValueChange = vi.fn();
    const onCancel = vi.fn();
    render(
      <skin.AnswerEditor
        text="Ответ"
        onTextChange={onTextChange}
        toolOutputs={[{ toolCallId: "s1", toolName: "search", value: "{ нет", onValueChange, error: labels.toolOutputInvalidJson, edited: true }]}
        onSave={vi.fn()}
        onCancel={onCancel}
        canSave={false}
        saving={false}
        error={labels.answerEditFailed}
      />,
    );
    fireEvent.change(screen.getByLabelText(labels.answerText), { target: { value: "Новый" } });
    expect(onTextChange).toHaveBeenCalledWith("Новый");
    fireEvent.change(screen.getByLabelText(labels.toolOutputJson("search")), { target: { value: "{}" } });
    expect(onValueChange).toHaveBeenCalledWith("{}");
    expect(screen.getByText(labels.toolOutputInvalidJson)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(labels.answerEditFailed);
    expect((screen.getByRole("button", { name: labels.answerEditSave }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: labels.answerEditCancel }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("Тандем: отметки правки в чате", () => {
  it("ответ: кнопка «изменить» по onEdit и отметка по edited", () => {
    const onEdit = vi.fn();
    render(
      <TooltipProvider>
        <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} notice={null} onEdit={onEdit} edited>
          <p>Текст</p>
        </TandemAgentMessage>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: russianLabels.editAnswer }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByText(russianLabels.answerEdited)).toBeTruthy();
  });

  it("ответ без onEdit и edited — ни кнопки, ни отметки", () => {
    render(
      <TooltipProvider>
        <TandemAgentMessage status="complete" onCopy={vi.fn()} empty={false} notice={null}>
          <p>Текст</p>
        </TandemAgentMessage>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: russianLabels.editAnswer })).toBeNull();
    expect(screen.queryByText(russianLabels.answerEdited)).toBeNull();
  });

  it("строка инструмента: отметка «результат изменён»", () => {
    render(<TandemToolCallRow toolName="search" state="done" open={false} onOpenChange={vi.fn()} outputEdited />);
    expect(screen.getByText(russianLabels.toolOutputEdited)).toBeTruthy();
  });
});

describe("Тандем: раздел «Чаты людей»", () => {
  const people = russianPeopleChatsLabels;
  const Sections = skin.SandboxSections!;
  const People = skin.PeopleChats!;
  const view = (patch: Partial<PeopleChatsView> = {}): PeopleChatsView => ({
    searchable: true,
    query: "",
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    peopleState: "idle",
    people: [],
    chatsState: "loading",
    chats: [],
    onChatsRetry: vi.fn(),
    copying: false,
    ...patch,
  });

  it("переключатель разделов: текущий отмечен, другой переключает", () => {
    const onSectionChange = vi.fn();
    render(
      <Sections section="sandbox" onSectionChange={onSectionChange}>
        <div>раздел</div>
      </Sections>,
    );
    const nav = screen.getByRole("navigation", { name: people.sections });
    expect(within(nav).getByRole("button", { name: people.sandboxSection }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(nav).getByRole("button", { name: people.peopleSection }));
    expect(onSectionChange).toHaveBeenCalledWith("people");
    expect(screen.getByText("раздел")).toBeTruthy();
  });

  it("поиск: поле подписано по наличию поиска, отправка зовёт onSearch", () => {
    stubScreen(true);
    const onSearch = vi.fn();
    const onQueryChange = vi.fn();
    const { rerender } = render(<People {...view({ onSearch, onQueryChange })} />);
    fireEvent.change(screen.getByLabelText(people.searchPerson), { target: { value: "вер" } });
    expect(onQueryChange).toHaveBeenCalledWith("вер");
    fireEvent.click(screen.getByRole("button", { name: people.search }));
    expect(onSearch).toHaveBeenCalled();
    rerender(<People {...view({ searchable: false })} />);
    expect(screen.getByLabelText(people.personId)).toBeTruthy();
    expect(screen.getByRole("button", { name: people.openPerson })).toBeTruthy();
  });

  it("люди и чаты: выбор, отметка чата объекта, открытый чат на чтение с копией и ошибкой", () => {
    stubScreen(false);
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    render(
      <People
        {...view({
          peopleState: "ready",
          people: [{ id: "vera", name: "Вера", hint: "vera@example.com", selected: true, onSelect }],
          person: { id: "vera", name: "Вера" },
          chatsState: "ready",
          chats: [{ id: "c1", title: null, updatedAt: "2026-10-01T10:00:00.000Z", subject: true, selected: true, onOpen }],
          chat: <div>лента</div>,
          onCopy,
          copyError: people.emptyChat,
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /Вера/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(people.untitledChat) }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText(people.subjectChat)).toBeTruthy();
    expect(screen.getByText(people.readOnly)).toBeTruthy();
    expect(screen.getByText("лента")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: people.copy }));
    expect(onCopy).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(people.emptyChat);
  });

  it("состояния: никого не нашли; чаты не загрузились — повтор", () => {
    stubScreen(true);
    const onChatsRetry = vi.fn();
    render(<People {...view({ peopleState: "empty", person: { id: "vera" }, chatsState: "failed", onChatsRetry })} />);
    expect(screen.getByText(people.nobodyFound)).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: labels.retry }));
    expect(onChatsRetry).toHaveBeenCalled();
  });
});

describe("Тандем: «Открыть чат снова» в песочнице", () => {
  const reopen = russianChatReopenLabels;
  const ChatReopen = skin.ChatReopen!;

  it("кнопка зовёт onReopen; во время запроса неактивна и называется «Открываем…»", () => {
    const onReopen = vi.fn();
    const { rerender } = render(<ChatReopen onReopen={onReopen} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: reopen.reopen }));
    expect(onReopen).toHaveBeenCalledOnce();
    rerender(<ChatReopen onReopen={onReopen} pending />);
    const busy = screen.getByRole("button", { name: reopen.reopening }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });

  it("ошибка видна как alert", () => {
    render(<ChatReopen onReopen={() => undefined} pending={false} error={reopen.failed} />);
    expect(screen.getByRole("alert").textContent).toContain(reopen.failed);
  });
});
