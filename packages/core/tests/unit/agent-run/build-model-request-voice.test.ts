import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { voiceModePart } from "../../../src/agent-run/mode-notes";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { mockModel, reasoningAndTextParts, streamOf } from "../support/mock-model";

const instructions = "Ты помощник.";
const notes = { voice: "ВХОД В ГОЛОС", text: "ВОЗВРАТ К ТЕКСТУ" };
const MEMORY = "<agent_memory>\nСправка\n</agent_memory>";

const provider: ProviderDescription = {
  id: "sliding",
  displayName: "Sliding",
  apiKeyEnv: "SLIDING_KEY",
  createLanguageModel: () => mockModel(() => streamOf(reasoningAndTextParts(["ок"]))),
  requestOptions: () => ({ lastMessageProviderOptions: { sliding: { cache: "on" } } }),
};
const profile: ModelProfile = {
  id: "sliding-model",
  displayName: "Sliding",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true },
  providerModelIds: { sliding: "m" },
};
const catalog = extendCatalog(standardCatalog, { addModels: [profile], addProviders: [provider] });

const human = (id: string, text: string, voice = false): AgentChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }, ...(voice ? [voiceModePart()] : [])],
});
const agent = (id: string, text: string): AgentChatMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] });

const build = (history: readonly AgentChatMessage[], { memoryBlock, ...extra }: { modeNotes?: typeof notes; memoryBlock?: string } = {}) =>
  buildModelRequest({
    catalog,
    modelId: "sliding-model",
    providerId: "sliding",
    chatId: "c",
    instructions,
    history,
    env: { SLIDING_KEY: "k" },
    ...(memoryBlock && {
      frozenContext: { current: { answerId: "a-next", data: { blocks: [{ key: "memory", text: memoryBlock, private: true }], sent: "all" as const, base: null } }, group: false },
    }),
    ...extra,
  });

const partTexts = (message: { content: unknown }): string[] =>
  typeof message.content === "string"
    ? [message.content]
    : (message.content as Array<{ type: string; text?: string }>).flatMap((part) => (part.type === "text" ? [part.text!] : []));

describe("buildModelRequest: пометки режима (FR-023)", () => {
  const voiceChat = [human("u1", "Привет", true), agent("a1", "Здравствуйте"), human("u2", "Как дела?", true)];

  it("пометка входа — отдельная текстовая часть в конце первого голосового сообщения; отдельного сообщения в конце нет", async () => {
    const { messages } = await build(voiceChat, { modeNotes: notes });
    expect(messages).toHaveLength(voiceChat.length);
    expect(partTexts(messages[0]!)).toEqual(["Привет", notes.voice]);
    expect(partTexts(messages[2]!)).toEqual(["Как дела?"]);
  });

  it("возврат к тексту: пометка у первого текстового сообщения после голосового", async () => {
    const { messages } = await build([...voiceChat, agent("a2", "Хорошо"), human("u3", "Теперь текстом")], { modeNotes: notes });
    expect(partTexts(messages[4]!)).toEqual(["Теперь текстом", notes.text]);
  });

  it("отметка не уходит модели: у сообщения только текстовые части", async () => {
    const { messages } = await build(voiceChat, { modeNotes: notes });
    expect(JSON.stringify(messages)).not.toContain("voice-mode");
  });

  it("без пометок в настройках запрос как без голосовых отметок", async () => {
    const plain = await build([human("u1", "Привет"), agent("a1", "Здравствуйте"), human("u2", "Как дела?")]);
    expect((await build(voiceChat)).messages).toEqual(plain.messages);
  });

  it("кэш: запрос следующего хода начинается с тех же сообщений, что запрос предыдущего, включая пометки", async () => {
    const turn1 = [human("u1", "Привет", true)];
    const turn2 = [...turn1, agent("a1", "Здравствуйте"), human("u2", "Как дела?", true)];
    const turn3 = [...turn2, agent("a2", "Хорошо"), human("u3", "Спасибо")];
    const turn4 = [...turn3, agent("a3", "Пожалуйста"), human("u4", "А теперь голосом", true)];
    const requests = [];
    for (const history of [turn1, turn2, turn3, turn4]) requests.push(await build(history, { modeNotes: notes }));
    for (let n = 1; n < requests.length; n++) {
      const previous = requests[n - 1]!.messages;
      // Метка кэша и блок памяти живут на последнем сообщении запроса: сравниваем всё, что до него.
      const beforeLast = previous.slice(0, -1);
      expect(JSON.stringify(requests[n]!.messages.slice(0, beforeLast.length))).toBe(JSON.stringify(beforeLast));
      expect(JSON.stringify(requests[n]!.instructions)).toBe(JSON.stringify(requests[0]!.instructions));
    }
  });

  it("метка кэша остаётся на последнем сообщении запроса", async () => {
    const request = await build(voiceChat, { modeNotes: notes });
    const marked = request.messages.flatMap((message, index) => (message.providerOptions ? [index] : []));
    expect(marked).toEqual([voiceChat.length - 1]);
  });

  it("порядок в последнем сообщении человека: пометка режима, затем блок памяти", async () => {
    const { messages } = await build([human("u1", "Привет", true)], { modeNotes: notes, memoryBlock: MEMORY });
    expect(partTexts(messages[0]!)).toEqual(["Привет", notes.voice, MEMORY]);
  });

  it("память у последнего сообщения, пометка входа у более раннего: каждая на своём месте", async () => {
    const { messages } = await build(voiceChat, { modeNotes: notes, memoryBlock: MEMORY });
    expect(partTexts(messages[0]!)).toEqual(["Привет", notes.voice]);
    expect(partTexts(messages[2]!)).toEqual(["Как дела?", MEMORY]);
  });

  it("пустая история: запрос строится без ошибок", async () => {
    expect((await build([], { modeNotes: notes })).messages).toEqual([]);
  });
});
