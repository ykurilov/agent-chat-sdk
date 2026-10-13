// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { VideosClient } from "../src/agent-chat-extensions";
import { russianLabels } from "../src/labels";
import type { AgentVideoView, ChatSkin } from "../src/skin-contract";
import type { AssistantTextDelta, DialogChatBridge, VoiceDialogEngine, VoiceDialogView } from "../src/voice-dialog";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

/** Поддельный клиент видео: экран не зависит от пакета видео, договор тот же. */
const describeCall = vi.fn<VideosClient["describe"]>((part) => {
  if (part.state === "input-streaming" || part.state === "input-available") return { state: "loading" };
  if (part.state !== "output-available") return undefined;
  const output = part.output as { видео?: { название: string } };
  if (!output.видео) return undefined;
  return {
    state: "ready",
    video: {
      id: part.toolCallId,
      title: output.видео.название,
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0&start=200",
      pageUrl: "https://www.youtube.com/watch?v=aircAruvnKk&t=200s",
      duration: "18:40",
      start: "3:20",
    },
  };
});
const videos: VideosClient = { toolName: "show_video", describe: describeCall };

const shown = (toolCallId: string, title: string) => ({
  type: "tool-show_video",
  toolCallId,
  state: "output-available",
  input: { id: "x" },
  output: { видео: { название: title } },
});
const answer = (id: string, parts: Array<Record<string, unknown>>): HistoryMessage => ({
  id,
  role: "assistant",
  parts: [...parts, { type: "text", text: `ответ ${id}`, state: "done" }],
  metadata: { status: "complete" },
});
const feed: HistoryMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Покажи урок" }] },
  answer("m1", [
    { type: "tool-find_videos", toolCallId: "f1", state: "output-available", input: { query: "сети" }, output: { найдено: [] } },
    shown("v1", "Что такое [нейросеть]"),
    { type: "tool-show_video", toolCallId: "v2", state: "output-available", input: { id: "нет" }, output: { отказ: "Такого видео нет в каталоге." } },
  ]),
];

function AgentVideo({ title, embedUrl, duration, start }: AgentVideoView) {
  return <div data-kind="video" data-title={title} data-embed={embedUrl} data-duration={duration} data-start={start} />;
}
const videoSkin: ChatSkin = { ...stubSkin, AgentVideo };

const toolRows = () => [...document.querySelectorAll<HTMLElement>('[data-kind="tool"]')].map((row) => row.dataset.tool);

describe("договор скина, версия 14: видео", () => {
  it("AgentVideo — необязательная часть с видом AgentVideoView; надписи видео", () => {
    expectTypeOf<NonNullable<ChatSkin["AgentVideo"]>>().toEqualTypeOf<ComponentType<AgentVideoView>>();
    expectTypeOf<AgentVideoView["provider"]>().toEqualTypeOf<"youtube" | "kinescope">();
    expect(stubSkin.AgentVideo).toBeUndefined();
    expect({ ...russianLabels.videos, from: russianLabels.videos.from("3:20"), onScreen: russianLabels.voice.videoOnScreen }).toEqual({
      play: "Смотреть видео",
      from: "с 3:20",
      fullscreen: "На весь экран",
      onScreen: "видео на экране",
    });
  });
});

describe("AgentChat: видео агента (FR-010, FR-012)", () => {
  it("show_video рисуется частью AgentVideo; отказ и другие инструменты — строкой", async () => {
    describeCall.mockClear();
    renderAgentChat(fakeChatServer({ history: feed }), { skin: videoSkin, videos });
    await screen.findByText("ответ m1");
    const card = document.querySelector<HTMLElement>('[data-kind="video"]');
    expect(card?.dataset.title).toBe("Что такое [нейросеть]");
    expect(card?.dataset.start).toBe("3:20");
    expect(card?.dataset.embed).toContain("youtube-nocookie.com");
    expect(toolRows()).toEqual(["find_videos", "show_video"]);
    expect(describeCall.mock.calls.every(([part]) => part.toolCallId.startsWith("v"))).toBe(true);
  });

  it("пока вызов идёт — ни карточки, ни строки", async () => {
    const pending = [
      feed[0]!,
      answer("m1", [{ type: "tool-show_video", toolCallId: "v1", state: "input-available", input: { id: "x" } }]),
    ];
    renderAgentChat(fakeChatServer({ history: pending }), { skin: videoSkin, videos });
    await screen.findByText("ответ m1");
    expect(document.querySelector('[data-kind="video"]')).toBeNull();
    expect(toolRows()).toEqual([]);
  });

  it("скин без AgentVideo — ссылка на страницу видео через AgentText (US4)", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { videos });
    await screen.findByText("ответ m1");
    const texts = [...document.querySelectorAll<HTMLElement>('[data-kind="text"]')].map((node) => node.textContent);
    expect(texts).toContain("▶ [Что такое \\[нейросеть\\]](https://www.youtube.com/watch?v=aircAruvnKk&t=200s) · с 3:20");
    expect(toolRows()).toEqual(["find_videos", "show_video"]);
  });

  it("запасная ссылка: переводы строк в названии — пробел, знаки markdown экранированы", async () => {
    const tricky: HistoryMessage[] = [answer("m1", [shown("v1", "Урок\n# *жирно* _к_ `код` <b>!</b>\r\n[x](https://evil.example)")])];
    renderAgentChat(fakeChatServer({ history: tricky }), { videos });
    await screen.findByText("ответ m1");
    const texts = [...document.querySelectorAll<HTMLElement>('[data-kind="text"]')].map((node) => node.textContent);
    expect(texts).toContain(
      "▶ [Урок \\# \\*жирно\\* \\_к\\_ \\`код\\` \\<b\\>\\!\\</b\\> \\[x\\]\\(https://evil.example\\)](https://www.youtube.com/watch?v=aircAruvnKk&t=200s) · с 3:20",
    );
  });

  it("без videos — строка инструмента, как раньше", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: videoSkin });
    await screen.findByText("ответ m1");
    expect(document.querySelector('[data-kind="video"]')).toBeNull();
    expect(toolRows()).toEqual(["find_videos", "show_video", "show_video"]);
  });
});

describe("голосовой режим: «видео на экране» (FR-013)", () => {
  function fakeEngine() {
    const opened: Array<{ chat: DialogChatBridge; onView: (view: VoiceDialogView) => void }> = [];
    const engine: VoiceDialogEngine = {
      open: (options) => void opened.push(options),
      close: vi.fn(),
      selectVoice: vi.fn(async () => {}),
      loadVoices: async () => ({ voices: [], current: "", persisted: false }),
    };
    return { engine, opened };
  }

  async function openDialog(server: ReturnType<typeof fakeChatServer>) {
    const fake = fakeEngine();
    renderAgentChat(server, { skin: videoSkin, videos, voiceDialog: fake.engine });
    fireEvent.click(await screen.findByLabelText("голосовой режим"));
    await waitFor(() => expect(fake.opened).toHaveLength(1));
    const deltas: AssistantTextDelta[] = [];
    fake.opened[0]!.chat.subscribeAssistantText((delta) => deltas.push(delta));
    return { bridge: fake.opened[0]!.chat, deltas };
  }

  it("показанное видео — фраза один раз, отказ не звучит", async () => {
    const server = fakeChatServer();
    const { bridge, deltas } = await openDialog(server);
    act(() => bridge.send("Покажи урок"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    const stream = server.streams[0]!;
    act(() => {
      stream.push({ type: "start", messageId: "a1" });
      stream.push({ type: "tool-input-available", toolCallId: "v1", toolName: "show_video", input: { id: "x" } });
    });
    await act(async () => {});
    expect(deltas).toEqual([]);
    act(() => {
      stream.push({ type: "tool-output-available", toolCallId: "v1", output: { видео: { название: "Урок" } } });
      stream.push({ type: "tool-input-available", toolCallId: "v2", toolName: "show_video", input: { id: "нет" } });
      stream.push({ type: "tool-output-available", toolCallId: "v2", output: { отказ: "нет" } });
    });
    await waitFor(() => expect(deltas.map((delta) => delta.text).join("")).toContain("видео на экране"));
    act(() => stream.push({ type: "message-metadata", messageMetadata: { status: "complete", reasoningDurationsMs: {} } }));
    stream.end();
    await act(async () => {});
    expect(deltas.filter((delta) => delta.text.includes("видео на экране"))).toHaveLength(1);
  });

  it("видео, показанное до включения режима, не звучит", async () => {
    const server = fakeChatServer({ history: feed });
    const { deltas } = await openDialog(server);
    await act(async () => {});
    expect(deltas).toEqual([]);
  });
});
