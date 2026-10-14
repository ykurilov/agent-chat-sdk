import type { ReplyCheck, ReplyCheckInput } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { flowKnownTexts } from "../../src/runtime/flow-known-texts";
import { parseFlow } from "../../src/format/parse-flow";
import { fixtureJson, stateOf } from "../flow-fixtures";
import { flowChat, newChat, OWNER, say } from "./flow-chat";

// 066: тексты сценария законны в проверках ответа: первое сообщение, прощание, тексты нод, рамки дня, попутные задачи.

/** Сценарий с ссылками во всех местах, где автор пишет тексты. */
function flowWithLinks(json: Record<string, any>) {
  json.common = "Общее: https://common.example";
  stateOf(json, "intro").firstMessage = "Привет! Запись: https://first.example";
  stateOf(json, "block").instructions = "Цель.\nНода: https://node.example";
  json.schedule = {
    dayStart: "09:00",
    nightFrom: "21:00",
    lengthDays: 3,
    deadlineState: "soft",
    farewellOnDeadline: true,
    farewellText: "Прощание: https://bye.example",
    dayFrame: { hardAt: 9, hardText: "На сегодня всё: https://frame.example" },
  };
  json.sideTasks = [{ id: "ask_site", text: "Спросить сайт: https://task.example", maxAttempts: 2, perConversation: true }];
}

function watching(seen: ReplyCheckInput[]): ReplyCheck {
  return async (input) => {
    seen.push(input);
  };
}

describe("066: flowKnownTexts", () => {
  it("общая часть, ноды, первые сообщения, прощание, рамка дня, попутные задачи", () => {
    const json = fixtureJson("sales-review");
    flowWithLinks(json);
    const parsed = parseFlow(json);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const all = flowKnownTexts(parsed.flow).join("\n");
    for (const link of ["common", "first", "node", "bye", "frame", "task"]) expect(all).toContain(`https://${link}.example`);
  });

  it("пустые тексты не попадают", () => {
    const parsed = parseFlow(fixtureJson("sales-review"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(flowKnownTexts(parsed.flow).every((text) => text.trim() !== "")).toBe(true);
  });
});

describe("066: withChat добавляет тексты сценария к knownTexts проверок", () => {
  it("на ходе: свои тексты приложения и тексты сценария чата в seenTexts", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = flowChat({ edit: flowWithLinks, chatOptions: { replyChecks: { checks: [watching(seen)], knownTexts: () => ["Своё: https://own.example"] } } });
    const { id } = await newChat(service);
    await say(service, id, "Курс по акварели");
    const all = seen.at(-1)!.seenTexts.join("\n");
    for (const link of ["own", "common", "first", "node", "bye", "frame", "task"]) expect(all).toContain(`https://${link}.example`);
  });

  it("список проверок без своих knownTexts тоже получает тексты сценария; service.checkReply — тот же набор", async () => {
    const seen: ReplyCheckInput[] = [];
    const { service } = flowChat({ edit: flowWithLinks, chatOptions: { replyChecks: [watching(seen)] } });
    const { id } = await newChat(service);
    await say(service, id, "Курс по акварели");
    seen.length = 0;
    await service.checkReply({ ownerId: OWNER, chatId: id, text: "Запишитесь: https://first.example" });
    expect(seen[0]!.seenTexts.join("\n")).toContain("https://first.example");
    expect(seen[0]!.seenTexts.join("\n")).toContain("https://bye.example");
  });

  it("чат без сценария и сбой чтения — только свои тексты; без replyChecks настройка не появляется", async () => {
    const seen: ReplyCheckInput[] = [];
    const plain = flowChat({ flowJson: null, chatOptions: { replyChecks: { checks: [watching(seen)], knownTexts: () => ["Своё"] } } });
    const chat = await newChat(plain.service);
    await say(plain.service, chat.id, "привет");
    expect(seen.at(-1)!.seenTexts).toContain("Своё");
    expect(seen.at(-1)!.seenTexts.join("\n")).not.toContain("https://common.example");
    expect((flowChat().options as { replyChecks?: unknown }).replyChecks).toBeUndefined();
  });
});
