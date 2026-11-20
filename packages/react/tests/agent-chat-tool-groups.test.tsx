// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { kinds, renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import type { ChatSkin } from "../src/skin-contract";

setupChatDom();

// Договор 37: в подробном виде одинаковые законченные вызовы подряд — одна строка «… ×N» (`ToolCallGroup`), раскрывается
// по нажатию. Вызов с ошибкой и ждущий подтверждения в группу не прячутся.

const groupSkin: ChatSkin = {
  ...stubSkin,
  ToolCallGroup: ({ toolName, title, count, open, onOpenChange, children }) => (
    <div data-kind="tool-group" data-tool={toolName} data-title={title ?? ""} data-count={String(count)} data-open={String(open)}>
      <button type="button" aria-label="группа" aria-expanded={open} onClick={() => onOpenChange(!open)} />
      {open && children}
    </div>
  ),
};

const done = (id: string, toolName = "view_result", title?: string) => ({
  type: `tool-${toolName}`,
  toolCallId: id,
  state: "output-available",
  input: { id },
  output: "ok",
  ...(title !== undefined && { title }),
});
const failed = (id: string) => ({ type: "tool-view_result", toolCallId: id, state: "output-error", input: { id }, errorText: "нет" });

const answer = (parts: unknown[]): HistoryMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Посмотри" }] },
  { id: "a1", role: "assistant", parts: [...parts, { type: "text", text: "Готово." }] as HistoryMessage["parts"], metadata: { status: "complete" } },
];

const groups = () =>
  Array.from(document.querySelectorAll('[data-kind="tool-group"]')).map((element) => ({
    tool: element.getAttribute("data-tool"),
    count: element.getAttribute("data-count"),
  }));

describe("AgentChat: одинаковые вызовы подряд одной строкой (договор 37)", () => {
  it("четыре одинаковых законченных вызова — одна группа ×4, строки внутри по раскрытию", async () => {
    renderAgentChat(fakeChatServer({ history: answer([done("1"), done("2"), done("3"), done("4")]) }), { skin: groupSkin });
    await waitFor(() => expect(groups()).toEqual([{ tool: "view_result", count: "4" }]));
    expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(0);
    fireEvent.click(document.querySelector('[aria-label="группа"]')!);
    await waitFor(() => expect(document.querySelectorAll('[data-kind="tool"]')).toHaveLength(4));
    expect(kinds()).toEqual(["user", "agent", "tool-group", "tool", "tool", "tool", "tool", "text"]);
  });

  it("вызов с ошибкой рвёт группу и стоит отдельной строкой", async () => {
    renderAgentChat(fakeChatServer({ history: answer([done("1"), done("2"), failed("3"), done("4"), done("5")]) }), { skin: groupSkin });
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool-group", "tool", "tool-group", "text"]));
    expect(document.querySelector('[data-kind="tool"]')!.getAttribute("data-state")).toBe("error");
  });

  it("разные инструменты и разные названия — разные строки; одиночный вызов — обычная строка", async () => {
    renderAgentChat(
      fakeChatServer({ history: answer([done("1"), done("2", "search"), done("3", "search", "Поиск А"), done("4", "search", "Поиск Б")]) }),
      { skin: groupSkin },
    );
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool", "tool", "tool", "tool", "text"]));
  });

  it("ждущий подтверждения вызов в группу не прячется", async () => {
    const asking = { type: "tool-view_result", toolCallId: "3", state: "approval-requested", input: { id: "3" }, approval: { id: "ap1" } };
    const history = answer([done("1"), done("2"), asking]);
    history[1]!.metadata = { status: "awaiting_approval" };
    renderAgentChat(fakeChatServer({ history }), { skin: groupSkin });
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool-group", "tool", "text"]));
    expect(document.querySelector('[data-kind="tool"]')!.getAttribute("data-approval")).toBe("requested");
  });

  it("вызов с ошибкой в обычном выходе ({ error }) и недописанный вызов в зелёную группу не попадают", async () => {
    const errorOutput = { ...done("2"), output: { error: "Нет доступа к странице" } };
    const preliminary = { ...done("5"), preliminary: true };
    renderAgentChat(fakeChatServer({ history: answer([done("1"), errorOutput, done("3"), done("4"), preliminary]) }), { skin: groupSkin });
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool", "tool", "tool-group", "tool", "text"]));
    expect(groups()).toEqual([{ tool: "view_result", count: "2" }]);
  });

  it("пока ответ идёт, строки не сворачиваются; свернутся, когда агент пошёл дальше, — раскрытая строка остаётся раскрытой", async () => {
    const server = fakeChatServer({ history: [] });
    renderAgentChat(server, { skin: groupSkin });
    const stream = await sendQuestion(server, "Посмотри работы");
    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    for (const id of ["1", "2"]) {
      stream.push({ type: "tool-input-available", toolCallId: id, toolName: "view_result", input: { id } });
      stream.push({ type: "tool-output-available", toolCallId: id, output: "ok" });
    }
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool", "tool"]));
    fireEvent.click(document.querySelector('[aria-label="вызов"]')!);
    await waitFor(() => expect(document.querySelector('[data-kind="tool"]')!.getAttribute("data-open")).toBe("true"));

    // Третий такой же вызов: идёт — строка своя; закончился — всё ещё строки, лента не скачет.
    stream.push({ type: "tool-input-available", toolCallId: "3", toolName: "view_result", input: { id: "3" } });
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool", "tool", "tool"]));
    stream.push({ type: "tool-output-available", toolCallId: "3", output: "ok" });
    stream.push({ type: "finish-step" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t" });
    await waitFor(() => expect(document.querySelectorAll('[data-kind="tool"][data-state="done"]')).toHaveLength(3));
    expect(kinds()).not.toContain("tool-group");

    // Агент пишет текст — серия закончилась и сворачивается одной строкой, раскрытая человеком строка видна.
    stream.push({ type: "text-delta", id: "t", delta: "Все три готовы." });
    await waitFor(() => expect(groups()).toEqual([{ tool: "view_result", count: "3" }]));
    expect(document.querySelector('[data-kind="tool-group"]')!.getAttribute("data-open")).toBe("true");
    expect(Array.from(document.querySelectorAll('[data-kind="tool"]')).map((row) => row.getAttribute("data-open"))).toEqual(["true", "false", "false"]);

    // Человек свернул группу — она не раскрывается снова сама.
    fireEvent.click(document.querySelector('[aria-label="группа"]')!);
    stream.finish();
    await waitFor(() => expect(document.querySelector('[data-kind="tool-group"]')!.getAttribute("data-open")).toBe("false"));
  });

  it("скин без ToolCallGroup (до версии 37) — строки как раньше", async () => {
    renderAgentChat(fakeChatServer({ history: answer([done("1"), done("2"), done("3")]) }));
    await waitFor(() => expect(kinds()).toEqual(["user", "agent", "tool", "tool", "tool", "text"]));
  });

  it("простой вид не меняется: там шаги и так схлопнуты", async () => {
    renderAgentChat(fakeChatServer({ history: answer([done("1"), done("2"), done("3")]) }), { skin: groupSkin, workView: "simple" });
    await waitFor(() => expect(kinds()).not.toContain("tool-group"));
  });
});
