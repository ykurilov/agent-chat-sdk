// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import type { AgentChatProps } from "../src/agent-chat";
import type { ChatSkin } from "../src/skin-contract";

setupChatDom();

type AnswerEditing = NonNullable<AgentChatProps["answerEditing"]>;

const question = (id: string, text: string): HistoryMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [
    { type: "tool-search", toolCallId: "call-1", state: "output-available", input: { q: "x" }, output: { found: 1 } },
    { type: "text", text, state: "done" },
  ],
  metadata: { status: "complete" },
});

/** Заглушка скина, которая показывает новые свойства: кнопку правки и отметки «изменено». */
const skin: ChatSkin = {
  ...stubSkin,
  AgentMessage: ({ children, onEdit, edited }) => (
    <article data-kind="agent" data-edited={String(edited ?? false)}>
      {children}
      {onEdit && (
        <button type="button" data-action="edit-answer" onClick={onEdit}>
          править
        </button>
      )}
    </article>
  ),
  ToolCallRow: ({ toolName, outputEdited }) => (
    <div data-kind="tool" data-output-edited={String(outputEdited ?? false)}>
      {toolName}
    </div>
  ),
};

function editingWith(edits: AnswerEditing["edits"] = new Map()) {
  const renderEditor = vi.fn<AnswerEditing["renderEditor"]>(({ message, onSaved, onCancel }) => (
    <div data-kind="answer-editor" data-message={message.id}>
      <button type="button" onClick={() => onSaved("a2")}>
        сохранить
      </button>
      <button type="button" onClick={onCancel}>
        отмена
      </button>
    </div>
  ));
  return { edits, renderEditor } satisfies AnswerEditing;
}

const editButtons = () => document.querySelectorAll('[data-action="edit-answer"]');

describe("лента: правка ответа агента", () => {
  it("без answerEditing кнопки правки и отметок нет", async () => {
    renderAgentChat(fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] }), { skin });
    await screen.findByText("Ответ");
    expect(editButtons()).toHaveLength(0);
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-edited")).toBe("false");
  });

  it("законченный ответ получает кнопку правки; отметки берутся из edits", async () => {
    const edits = new Map([["a1", { textEdited: false, editedToolCallIds: ["call-1"] }]]);
    renderAgentChat(fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] }), {
      skin,
      answerEditing: editingWith(edits),
    });
    await screen.findByText("Ответ");
    expect(editButtons()).toHaveLength(1);
    expect(document.querySelector('[data-kind="agent"]')?.getAttribute("data-edited")).toBe("true");
    expect(document.querySelector('[data-kind="tool"]')?.getAttribute("data-output-edited")).toBe("true");
  });

  it("пока чат отвечает, кнопок правки нет", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] });
    renderAgentChat(server, { skin, answerEditing: editingWith() });
    await screen.findByText("Ответ");
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(editButtons()).toHaveLength(0);
  });

  it("редактор встаёт вместо ответа; отмена возвращает ответ", async () => {
    const editing = editingWith();
    renderAgentChat(fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] }), { skin, answerEditing: editing });
    await screen.findByText("Ответ");
    fireEvent.click(editButtons()[0]!);
    expect(document.querySelector('[data-kind="answer-editor"]')?.getAttribute("data-message")).toBe("a1");
    expect(screen.queryByText("Ответ")).toBeNull();
    fireEvent.click(screen.getByText("отмена"));
    expect(document.querySelector('[data-kind="answer-editor"]')).toBeNull();
    expect(screen.getByText("Ответ")).toBeTruthy();
  });

  it("сохранение переключает чат на новую ветку", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] });
    server.state.branchTo = {
      a2: { messages: [question("u1", "Привет"), answer("a2", "Исправленный ответ")], forks: [{ messageId: "a2", siblingIds: ["a1", "a2"] }] },
    };
    renderAgentChat(server, { skin, answerEditing: editingWith() });
    await screen.findByText("Ответ");
    fireEvent.click(editButtons()[0]!);
    fireEvent.click(screen.getByText("сохранить"));
    await screen.findByText("Исправленный ответ");
    expect(server.requestsTo("branch")[0]?.body).toEqual({ messageId: "a2" });
    expect(document.querySelector('[data-kind="answer-editor"]')).toBeNull();
  });
});

describe("лента: onFeedChange", () => {
  it("сообщает сообщения ветки и занятость: при открытии и на старте хода", async () => {
    const server = fakeChatServer({ history: [question("u1", "Привет"), answer("a1", "Ответ")] });
    const onFeedChange = vi.fn();
    renderAgentChat(server, { skin, onFeedChange });
    await waitFor(() => expect(onFeedChange).toHaveBeenLastCalledWith(expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ id: "a1" })]), busy: false })));
    fireEvent.change(screen.getByLabelText("поле"), { target: { value: "Ещё" } });
    fireEvent.submit(screen.getByLabelText("поле").closest("form")!);
    await waitFor(() => expect(onFeedChange).toHaveBeenLastCalledWith(expect.objectContaining({ busy: true })));
  });
});

it("compact editor waits for full message, shows a local failure and retries without losing outputs",async()=>{
 const complete=answer("a1","Ответ");const compact={...complete,metadata:{status:"complete" as const,historyRevision:"MR",historyDetails:{0:{type:"tool-search",revision:"R"}}},parts:[{type:"tool-search",toolCallId:"call-1",state:"output-available" as const},{type:"text",text:"Ответ",state:"done" as const}]};
 const server=fakeChatServer({history:[question("u1","Привет"),compact]});const original=server.fetch;let attempts=0;
 server.fetch=async(input,init)=>{
   const url=new URL(String(input),"http://fixture");
   if(url.pathname.endsWith("/history-message"))return ++attempts===1?new Response(null,{status:503}):Response.json({branch:"B",messageId:"a1",revision:"MR",message:complete});
   const response=await original(input,init);
   if(url.pathname.endsWith("/c1")&&(!init?.method||init.method==="GET")&&response.ok)return Response.json({...await response.json(),historyView:{mode:"compact",branch:"B",olderCursor:null,headMessageId:"a1",totals:{messages:2,assistantAnswers:1},stateBefore:{}}});
   return response;
 };
 const editing=editingWith();renderAgentChat(server,{skin,history:"compact",answerEditing:editing});await screen.findByText("Ответ");
 fireEvent.click(editButtons()[0]!);await screen.findByRole("alert");expect(editing.renderEditor).not.toHaveBeenCalled();
 fireEvent.click(editButtons()[0]!);await waitFor(()=>expect(document.querySelector('[data-kind="answer-editor"]')).not.toBeNull());
 expect(editing.renderEditor.mock.calls.at(-1)![0].message.parts).toEqual(complete.parts);expect(attempts).toBe(2);
});
