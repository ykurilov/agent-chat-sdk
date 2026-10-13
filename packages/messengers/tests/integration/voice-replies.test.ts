import { afterEach, describe, expect, it } from "vitest";
import type { AudioTranscriber, VoiceReplies } from "../../src/types";
import { anna, oggOpusBytes } from "../fake-apis/rig";
import { allChannels } from "./support/channels";
import { type RealChat, startRealChat } from "./support/real-chat";

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** Расшифровка голосового — поддельная: настоящая проверяется в T079. */
const transcribe: AudioTranscriber = async () => ({ text: "Расскажи про погоду" });

/** Озвучка — поддельная: отдаёт Ogg и запоминает, что озвучивала. */
function fakeVoiceReplies(result: "audio" | "limit" = "audio") {
  const spoken: Array<{ text: string; ownerId: string; chatId: string; messageId: string }> = [];
  const voiceReplies: VoiceReplies = {
    async speak({ text, ownerId, chatId, messageId }) {
      spoken.push({ text, ownerId, chatId, messageId });
      return result === "limit" ? { skipped: "limit" } : { audio: oggOpusBytes(1500), mediaType: "audio/ogg", durationMs: 1500 };
    },
  };
  return { spoken, voiceReplies };
}

async function voiceChat(open: (typeof allChannels)[number]["open"], voiceReplies?: VoiceReplies) {
  const real = await startRealChat({ channel: await open(), messengers: { transcribe, ...(voiceReplies && { voiceReplies }) } });
  await real.link(anna, "anna");
  return real;
}

const annaChat = (real: RealChat) => real.channel.privateChatOf(anna);
const sayByVoice = (real: RealChat) => real.human({ type: "voice", chat: annaChat(real), from: anna, audio: oggOpusBytes(2000), durationMs: 2000 });
const kindsIn = (real: RealChat) => real.channel.outgoing.filter((message) => message.chatId === annaChat(real).id).map((message) => message.kind);

describe.each(allChannels)("T075 голосовой ответ на настоящей службе, $name", ({ open }) => {
  it("голосовое → ответ текстом и голосовым, озвучен ответ этого чата", async () => {
    const { spoken, voiceReplies } = fakeVoiceReplies();
    chat = await voiceChat(open, voiceReplies);
    await sayByVoice(chat);

    expect(chat.model.lastPromptText()).toContain("Расскажи про погоду");
    expect(kindsIn(chat)).toEqual(["text", "voice"]);
    expect(chat.textsIn(annaChat(chat).id)[0]).toBe("Ответ 1");
    const [only] = await chat.service.listChats("anna");
    const history = await chat.service.getHistory("anna", only?.id as string);
    const answer = history.messages.at(-1);
    expect(spoken).toEqual([{ text: "Ответ 1", ownerId: "anna", chatId: only?.id, messageId: answer?.id }]);
  });

  it("текстом спросили — текстом ответили, озвучки нет", async () => {
    const { spoken, voiceReplies } = fakeVoiceReplies();
    chat = await voiceChat(open, voiceReplies);
    await chat.human({ type: "text", chat: annaChat(chat), from: anna, text: "Привет" });
    expect(kindsIn(chat)).toEqual(["text"]);
    expect(spoken).toEqual([]);
  });

  it("без настройки голосового ответа — только текст", async () => {
    chat = await voiceChat(open);
    await sayByVoice(chat);
    expect(kindsIn(chat)).toEqual(["text"]);
    expect(chat.textsIn(annaChat(chat).id)).toEqual(["Ответ 1"]);
  });

  it("лимит озвучки (`skipped: \"limit\"`) — только текст, без ошибок", async () => {
    const { spoken, voiceReplies } = fakeVoiceReplies("limit");
    chat = await voiceChat(open, voiceReplies);
    await sayByVoice(chat);
    expect(spoken).toHaveLength(1);
    expect(kindsIn(chat)).toEqual(["text"]);
    expect(chat.errors).toEqual([]);
  });
});
