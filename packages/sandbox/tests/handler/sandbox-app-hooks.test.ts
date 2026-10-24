import { jsonSchema, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { AgentToolsModel, StateChangedInput, TurnFinished } from "@ykurilov/agent-chat-core";
import { setupSandbox } from "./support/sandbox-setup";
import type { ModelStep } from "./support/sandbox-setup";

/**
 * Хуки приложения в песочнице. Хуки, что пишут в данные приложения (`onStateChanged`, `onTurnFinished`,
 * `onModelChosen`), не зовутся ни в песочном чате, ни в копии чата человека: там ходит не человек приложения.
 * Решения, что только читают (`newChatGreeting`, `modelMenu`), получают настоящего админа, как инструменты.
 */
function withAppHooks() {
  const stateChanges: StateChangedInput[] = [];
  const finishedTurns: TurnFinished[] = [];
  const modelChoices: Array<{ userId: string; chatId: string }> = [];
  const greetingUsers: string[] = [];
  const menuUsers: string[] = [];
  let step = 0;
  const rememberStep: ModelStep[] = [{ toolCall: { id: "s1", name: "remember_step", input: {} } }, { text: "Записал" }];
  const setup = setupSandbox({
    // Каждый ход меняет состояние: в бою, в песочнице и в копии чата человека.
    steps: [...rememberStep, ...rememberStep],
    sandbox: { people: true },
    chat: {
      agent: {
        instructions: "Ты помощник.",
        tools: (model: AgentToolsModel) => ({
          remember_step: tool({
            description: "Запомнить шаг.",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
            execute: async () => {
              model.state!.set("step", ++step);
              return "запомнил";
            },
          }),
        }),
      },
      onStateChanged: (input) => void stateChanges.push(input),
      onStateChangedAttempts: 1,
      onTurnFinished: (turn) => void finishedTurns.push(turn),
      onModelChosen: ({ userId, chatId }) => void modelChoices.push({ userId, chatId }),
      newChatGreeting: ({ userId }) => {
        greetingUsers.push(userId);
        return { text: "Здравствуйте!" };
      },
      modelMenu: ({ userId }) => {
        menuUsers.push(userId);
        return userId === "anna";
      },
    },
  });
  return { setup, stateChanges, finishedTurns, modelChoices, greetingUsers, menuUsers };
}

describe("песочница: хуки приложения", () => {
  it("ход песочного чата не зовёт onStateChanged и onTurnFinished приложения", async () => {
    const { setup, stateChanges, finishedTurns } = withAppHooks();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "Запомни шаг");
    await afterHooks();

    expect(stateChanges).toEqual([]);
    expect(finishedTurns).toEqual([]);
  });

  it("боевой чат того же приложения хуки получает: они подключены", async () => {
    const { setup, stateChanges, finishedTurns } = withAppHooks();
    const created = await setup.callBattle("POST", "", { user: "vera", body: {} });
    const { id } = (await created.json()) as { id: string };
    const sent = await setup.callBattle("POST", `/${id}/messages`, {
      user: "vera",
      body: { message: { id: "u1", role: "user", parts: [{ type: "text", text: "Запомни шаг" }] } },
    });
    await sent.text();

    await vi.waitFor(() => expect(stateChanges).toHaveLength(1));
    await vi.waitFor(() => expect(finishedTurns).toHaveLength(1));
    expect(stateChanges[0]).toMatchObject({ ownerId: "vera", chatId: id });
    expect(finishedTurns[0]).toMatchObject({ userId: "vera", chatId: id });
  });

  it("выбор модели в песочном чате не зовёт onModelChosen приложения", async () => {
    const { setup, modelChoices } = withAppHooks();
    const chatId = await setup.createChat("anna");
    const response = await setup.call("PUT", `/${chatId}/model`, { body: { modelId: "mock-model", providerId: "mock" } });

    expect(response.status).toBe(200);
    expect(modelChoices).toEqual([]);
  });

  it("приветствие нового песочного чата решается для настоящего админа, а не для песочного владельца", async () => {
    const { setup, greetingUsers } = withAppHooks();
    const chatId = await setup.createChat("anna");

    expect(greetingUsers).toEqual(["anna"]);
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { messages: Array<{ role: string }> };
    expect(history.messages.map((message) => message.role)).toEqual(["assistant"]);
  });

  it("меню моделей в песочнице решается для настоящего админа", async () => {
    const { setup, menuUsers } = withAppHooks();
    const response = await setup.call("GET", "/models");

    expect(response.status).toBe(200);
    expect(menuUsers).toEqual(["anna"]);
  });

  it("ход в копии чата человека не зовёт onStateChanged и onTurnFinished: данные человека не меняются", async () => {
    const { setup, stateChanges, finishedTurns } = withAppHooks();
    const created = await setup.callBattle("POST", "", { user: "vera", body: {} });
    const { id: personChatId } = (await created.json()) as { id: string };
    await (
      await setup.callBattle("POST", `/${personChatId}/messages`, {
        user: "vera",
        body: { message: { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] } },
      })
    ).text();
    await vi.waitFor(() => expect(finishedTurns).toHaveLength(1));
    const sandbox = setupSandboxPeople(setup);
    const copyId = await sandbox.copy("vera", personChatId);
    stateChanges.length = 0;
    finishedTurns.length = 0;
    await setup.send(copyId, "Запомни шаг");
    await afterHooks();

    expect(stateChanges).toEqual([]);
    expect(finishedTurns).toEqual([]);
  });
});

/** Хуки, которые ход не ждёт, успели бы прийти. */
async function afterHooks() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Копия чата человека через раздел «Чаты людей». */
function setupSandboxPeople(setup: ReturnType<typeof setupSandbox>) {
  return {
    async copy(person: string, chatId: string): Promise<string> {
      const response = await setup.call("POST", `/people/${person}/${chatId}/staff-copy`, { user: "anna" });
      if (response.status !== 201) throw new Error(`копия не создана: ${response.status} ${await response.text()}`);
      return ((await response.json()) as { id: string }).id;
    },
  };
}
