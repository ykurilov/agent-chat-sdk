import { describe, expect, it, vi } from "vitest";
import { createMemorySandboxJournal } from "../../src/index";
import type { SandboxJournal } from "../../src/index";
import { sandboxBase, setupSandbox } from "./support/sandbox-setup";

const MEBIBYTE = 1024 * 1024;

describe("тело запроса песочницы", () => {
  it("по заголовку content-length больше 1 МиБ — 413, тело не читается", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const response = await setup.sandbox.fetch(
      new Request(`${sandboxBase}/chats/${chatId}/settings`, {
        method: "PUT",
        headers: { "x-user": "anna", "content-type": "application/json", "content-length": String(MEBIBYTE + 1) },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("без content-length тело читается потоком и обрывается после 1 МиБ — 413", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64 * 1024).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await setup.sandbox.fetch(
      new Request(`${sandboxBase}/chats/${chatId}/settings`, { method: "PUT", headers: { "x-user": "anna", "content-type": "application/json" }, body, duplex: "half" } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(40); // 1 МиБ — это 16 кусков по 64 КиБ; бесконечный поток не дочитывается
  });

  it("нормальное тело проходит", async () => {
    const setup = setupSandbox();
    const chatId = await setup.createChat();
    const response = await setup.call("PUT", `/chats/${chatId}/settings`, { body: { instructions: "Коротко." } });
    expect(response.status).toBe(200);
  });
});

/** Журнал, у которого заданные операции падают. */
function failingJournal(failing: Array<"markAnswerEdited" | "deleteChat">): SandboxJournal {
  const inner = createMemorySandboxJournal({ env: {}, logError: () => {} });
  return {
    ...inner,
    markAnswerEdited: async (record) => {
      if (failing.includes("markAnswerEdited")) throw new Error("база журнала недоступна");
      return inner.markAnswerEdited(record);
    },
    deleteChat: async (chatId) => {
      if (failing.includes("deleteChat")) throw new Error("база журнала недоступна");
      return inner.deleteChat(chatId);
    },
  };
}

describe("действие уже применено — ответ успешный, сбой журнала в лог", () => {
  it("правка ответа: сбой markAnswerEdited не даёт 500", async () => {
    const setup = setupSandbox({ sandbox: { journal: failingJournal(["markAnswerEdited"]) } });
    const chatId = await setup.createChat();
    await setup.send(chatId);
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { messages: Array<{ id: string; role: string }> };
    const answer = history.messages.find((message) => message.role === "assistant")!;
    const response = await setup.call("POST", `/chats/${chatId}/messages/${answer.id}/answer-edit`, { body: { text: "Исправленный ответ" } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { messageId: string }).messageId).toBeTruthy();
    expect(setup.errors.join("\n")).toContain("база журнала недоступна");
  });

  it("удаление чата: сбой journal.deleteChat не даёт 500", async () => {
    const setup = setupSandbox({ sandbox: { journal: failingJournal(["deleteChat"]) } });
    const chatId = await setup.createChat();
    const response = await setup.call("DELETE", `/${chatId}`);
    expect(response.status).toBe(204);
    expect(setup.errors.join("\n")).toContain("база журнала недоступна");
    expect((await setup.call("GET", `/${chatId}`)).status).toBe(404);
  });
});

describe("порядок проверок", () => {
  it("не-админ с чужого источника получает 404, а не 403", async () => {
    const setup = setupSandbox();
    const response = await setup.call("POST", "", { user: "stranger", body: {}, origin: "http://evil.example" });
    expect(response.status).toBe(404);
  });

  it("админ с чужого источника по-прежнему получает 403", async () => {
    const setup = setupSandbox();
    const response = await setup.call("POST", "", { body: {}, origin: "http://evil.example" });
    expect(response.status).toBe(403);
  });
});

describe("чаты объектов приложения в песочнице", () => {
  it("POST {base}/subject не зовёт subjectChats приложения и не создаёт чат объекта у `sandbox:<админ>`", async () => {
    const subjectChats = vi.fn(async () => ({ title: "Урок 1" }));
    const setup = setupSandbox({ chat: { subjectChats } });
    const response = await setup.call("POST", "/subject", { body: { key: "lesson:1" }, origin: "http://test.local" });
    expect(response.status).not.toBe(200);
    expect(subjectChats).not.toHaveBeenCalled();
    expect(await setup.storage.findChatBySubject!("sandbox:anna", "lesson:1")).toBeNull();
    // Боевой чат приложения адресом пользуется как прежде.
    expect((await setup.callBattle("POST", "/subject", { body: { key: "lesson:1" }, origin: "http://test.local" })).status).toBe(200);
    expect(subjectChats).toHaveBeenCalledTimes(1);
  });
});
