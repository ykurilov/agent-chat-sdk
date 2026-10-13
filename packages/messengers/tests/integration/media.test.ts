import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { transcribeAudioFile } from "@ykurilov/agent-chat-voice/server";
import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import type { AttachmentIngest, AudioTranscriber } from "../../src/types";
import { anna, oggOpusBytes } from "../fake-apis/rig";
import { allChannels, maxChannel } from "./support/channels";
import { createFakeSoniox } from "./support/fake-soniox";
import { type RealChat, startRealChat } from "./support/real-chat";

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** Мост приложения: файл из мессенджера — в настоящие вложения службы (`ingestFile`). */
function attachmentsBridge() {
  const attachments = createAttachments({ storage: createMemoryAttachmentStorage() });
  const ingest: AttachmentIngest = ({ ownerId, chatId, bytes, name }) => attachments.ingestFile({ userId: ownerId, chatId, bytes, name });
  return { attachments, ingest };
}

/** Мост приложения: голосовое — в настоящее распознавание (`transcribeAudioFile`) с поддельным Soniox. */
function transcribeBridge(text: string) {
  const soniox = createFakeSoniox(text);
  const transcribe: AudioTranscriber = async ({ audio }) => ({
    text: await transcribeAudioFile({
      bytes: audio,
      apiKey: "не-настоящий-ключ",
      model: "stt-rt-preview",
      languageHints: ["ru"],
      websocketUrl: "wss://soniox.test/transcribe",
      logError: () => {},
      connectUpstream: soniox.connectUpstream,
    }),
  });
  return { soniox, transcribe };
}

describe.each(allChannels)("T079 файлы и голос на настоящей службе, $name", ({ open }) => {
  it("текстовый файл — через ingestFile во вложения чата, его текст уходит модели", async () => {
    const { attachments, ingest } = attachmentsBridge();
    chat = await startRealChat({ channel: await open(), server: { attachments }, messengers: { attachments: ingest } });
    await chat.link(anna, "anna");
    const dialog = chat.channel.privateChatOf(anna);
    await chat.human({ type: "file", chat: dialog, from: anna, name: "заметки.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("Склад: 12 коробок"), caption: "Посчитай" });

    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
    expect(chat.model.lastPromptText()).toContain("Склад: 12 коробок");
    expect(chat.model.lastPromptText()).toContain("Посчитай");
    expect(chat.errors).toEqual([]);
  });

  it("неподдерживаемый файл — понятный отказ словами, агент не запускается", async () => {
    const { attachments, ingest } = attachmentsBridge();
    chat = await startRealChat({ channel: await open(), server: { attachments }, messengers: { attachments: ingest } });
    await chat.link(anna, "anna");
    const dialog = chat.channel.privateChatOf(anna);
    await chat.human({ type: "file", chat: dialog, from: anna, name: "программа.exe", mediaType: "application/octet-stream", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff, 0xfe]) });

    expect(chat.textsIn(dialog.id)).toEqual([messengerTexts.fileRefused("unsupported_type")]);
    expect(chat.model.calls).toHaveLength(0);
  });

  it("голосовое — через transcribeAudioFile: Soniox получил весь звук, расшифровка уходит модели", async () => {
    const { soniox, transcribe } = transcribeBridge("Какая погода завтра");
    chat = await startRealChat({ channel: await open(), messengers: { transcribe } });
    await chat.link(anna, "anna");
    const dialog = chat.channel.privateChatOf(anna);
    const audio = oggOpusBytes(2000);
    await chat.human({ type: "voice", chat: dialog, from: anna, audio, durationMs: 2000 });

    expect(soniox.sessions).toHaveLength(1);
    expect(soniox.sessions[0]?.config).toMatchObject({ audio_format: "auto", model: "stt-rt-preview" });
    expect(soniox.sessions[0]?.audio).toEqual(audio);
    expect(chat.model.lastPromptText()).toContain(`[${messengerTexts.voiceMark}] Какая погода завтра`);
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
  });
});

describe("T079 MAX: готовая расшифровка мессенджера", () => {
  it("голосовое с расшифровкой MAX — своё распознавание не зовётся", async () => {
    const { soniox, transcribe } = transcribeBridge("не должно понадобиться");
    chat = await startRealChat({ channel: await maxChannel(), messengers: { transcribe } });
    await chat.link(anna, "anna");
    const dialog = chat.channel.privateChatOf(anna);
    await chat.human({ type: "voice", chat: dialog, from: anna, audio: oggOpusBytes(2000), durationMs: 2000, transcription: "Напомни про встречу" });

    expect(soniox.sessions).toEqual([]);
    expect(chat.model.lastPromptText()).toContain(`[${messengerTexts.voiceMark}] Напомни про встречу`);
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
  });
});
