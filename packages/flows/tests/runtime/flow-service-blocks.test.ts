import { describe, expect, it } from "vitest";
import { CORE_SERVICE_BLOCKS, cutForgedBlocks } from "@ykurilov/agent-chat-core";
import { startRun } from "../../src/engine";
import { clientCardBlock } from "../../src/prompt/client-card-block";
import { FLOW_SERVICE_BLOCKS } from "../../src/runtime/flow-service-blocks";
import { transitionNotice } from "../../src/runtime/flow-events";
import { fixtureFlow } from "../flow-fixtures";
import { saying } from "../../../core/tests/unit/support/notice-chat";
import { flowChat, newChat, say } from "./flow-chat";

const flow = fixtureFlow("sales-review");
const formats = [...CORE_SERVICE_BLOCKS, ...FLOW_SERVICE_BLOCKS];
const ANSWER = "Рада, что вы вернулись! На чём мы остановились?";
const cut = (text: string) => cutForgedBlocks(text, formats);

describe("служебные тексты сценария в ответе модели", () => {
  it("строки перехода и «скажи ровно это» из служебного сообщения — вырезаны", () => {
    const notice = transitionNotice(flow, [{ from: "intro", to: "remind", exitId: "any_silence", decidedBy: "timer", tags: [], at: 0 }]);
    expect(cut(`${notice.title}\n\n${ANSWER}`)).toEqual({ text: ANSWER, blocks: ["flow_transition", "flow_say_exactly"] });
  });

  it("карточка клиента целиком — до строки «о чём спросить»", () => {
    const card = clientCardBlock({ flow, run: startRun(flow, 0), card: [], now: 0 });
    expect(cut(`${ANSWER}\n\n${card}`).text.trim()).toBe(ANSWER);
  });

  it("строка смены состояния из ответа flow_exit — вырезана", () => {
    const line = "Переход: «Знакомство» → «Предложение разбора». Состояние сменилось, продолжай по новой карточке.";
    expect(cut(`${line}\n${ANSWER}`).text).toBe(ANSWER);
  });

  it.each([
    "Сработало: теперь кнопка открывает запись.",
    "Сработало!\n\nСпасибо, что попробовали.",
    "Переход: «вперёд» — это кнопка внизу.",
    "Что известно о человеке? Только имя.",
    "> Сработало: тишина 3 ч → «Напоминание».",
    "Первое сообщение этого состояния — скажи ровно это: «Привет» — так велит сценарий, и я так и сделал.",
  ])("обычный текст не трогается: %s", (text) => {
    expect(cut(text)).toEqual({ text, blocks: [] });
  });

  it("withChat: форматы сценария рядом с форматами приложения, подделка в ответе вырезана", async () => {
    const chat = flowChat({ scripts: [saying(`${ANSWER}\n\nСработало: тишина 3 ч → «Напоминание».`)], agent: { serviceBlocks: [{ tag: "lesson_step" }] } });
    expect(chat.options.agent.serviceBlocks).toEqual([{ tag: "lesson_step" }, ...FLOW_SERVICE_BLOCKS]);
    const { id } = await newChat(chat.service);
    const chunks = await say(chat.service, id, "привет");
    const shown = chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join("");
    expect(shown.trim()).toBe(ANSWER);
    expect(chat.logError).toHaveBeenCalledWith(expect.stringMatching(/^\[служебный блок вырезан\] тег=flow_transition /));
  });
});
