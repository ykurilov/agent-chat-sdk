import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { flowChat, newChat, OWNER, say } from "./flow-chat";
import { miniV1 } from "./migrate-flows";
import { parseFlow } from "../../src/format";

/*
 * Сценарий не сходится с подтверждениями приложения (`exitGuards` требует judge-выход, а в версии выход другой): проверка
 * идёт до сохранения версии и закрепления чата (аудит gemini-3/4). Невалидная версия не портит чаты — они идут без неё.
 */

const spec = { flowId: "mini", key: "ownPublished", revision: "1", states: ["publish"], judge: "Человек прислал ссылку на своё приложение." };
const guard = { flowId: "mini", state: "publish", exitId: "interest", requires: { key: spec.key, revision: spec.revision }, judgeWindow: "current-human-turn" as const };

function flowJson(exit: "judge" | "event") {
  const json = miniV1();
  json.start = "publish";
  const when = exit === "judge" ? { type: "judge", text: "Человек спрашивает про домен." } : { type: "event", event: "message" };
  json.states = [
    { id: "publish", title: "Результат", instructions: "Проверь публикацию.", exits: [{ id: "interest", when, to: "course" }] },
    { id: "course", title: "Курс", instructions: "Расскажи о курсе." },
  ] as unknown as typeof json.states;
  return json;
}

function setup(json = flowJson("event")) {
  return flowChat({ flowJson: json, flowOptions: { confirmations: [spec], exitGuards: [guard] } });
}

async function saveStored(chat: ReturnType<typeof setup>, versionId: string, json: Record<string, unknown>) {
  const parsed = parseFlow(json);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  await chat.store.saveVersion({ flowId: "mini", versionId, hash: createHash("sha256").update(versionId).digest("hex"), flow: parsed.flow, at: new Date().toISOString() });
}

const problemLogged = (chat: ReturnType<typeof setup>) =>
  chat.logError.mock.calls.some(([line]) => String(line).includes("не сходится с подтверждениями приложения"));

describe("сценарий против подтверждений приложения — до побочных эффектов", () => {
  it("loadFlow: версия не сохранена, чат не закреплён, ход идёт без сценария; строка в журнал", async () => {
    const chat = setup();
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");
    await chat.flow.settled();
    expect(await chat.store.getVersion("mini", "v1")).toBeNull();
    expect(await chat.store.getChat(id)).toBeNull();
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(problemLogged(chat)).toBe(true);
    await chat.flow.stop();
    await chat.service.flush();
  });

  it("adopt: отказ с причиной, версия не сохранена, чат не закреплён", async () => {
    const chat = setup();
    const { id } = await chat.service.createChat(OWNER);
    await expect(chat.flow.adopt({ ownerId: OWNER, chatId: id, flowId: "mini", versionId: "v1", flow: flowJson("event") })).rejects.toThrow("не сходится с подтверждениями");
    expect(await chat.store.getVersion("mini", "v1")).toBeNull();
    expect(await chat.store.getChat(id)).toBeNull();
    await chat.flow.stop();
    await chat.service.flush();
  });

  it("под номером уже сохранена невалидная версия: чат по ней не закрепляется, ход идёт без сценария", async () => {
    const chat = setup(flowJson("judge"));
    await saveStored(chat, "v1", flowJson("event"));
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toBeNull();
    expect(chat.model.doStreamCalls).toHaveLength(1);
    await chat.flow.stop();
    await chat.service.flush();
  });

  it("перевод на сохранённую невалидную версию — отказ, чаты остаются на прежней", async () => {
    const chat = setup(flowJson("judge"));
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");
    await chat.flow.settled();
    expect((await chat.store.getChat(id))?.versionId).toBe("v1");
    await saveStored(chat, "v2", flowJson("event"));
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map: {} })).rejects.toThrow("не прошла проверку");
    expect((await chat.store.getChat(id))?.versionId).toBe("v1");
    await chat.flow.stop();
    await chat.service.flush();
  });

  it("перевод на новую невалидную версию из запроса — отказ до записи, версия не сохранена", async () => {
    const chat = setup(flowJson("judge"));
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");
    await chat.flow.settled();
    await expect(chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", flow: flowJson("event"), map: {} })).rejects.toThrow("не разобран или с ошибками");
    expect((await chat.store.getChat(id))?.versionId).toBe("v1");
    expect(await chat.store.getVersion("mini", "v2")).toBeNull();
    await chat.flow.stop();
    await chat.service.flush();
  });
});
