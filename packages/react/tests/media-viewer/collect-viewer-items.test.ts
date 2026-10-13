import { describe, expect, it } from "vitest";
import type { MessageAttachmentsView } from "../../src/attachments-contract";
import type { AgentChatMessage } from "../../src/chat-types";
import { collectViewerItems } from "../../src/media-viewer/collect-viewer-items";
import type { MediaViewerItem } from "../../src/media-viewer/media-viewer-types";

const user = (id: string, files: Array<[string, string, string]>): AgentChatMessage => ({
  id,
  role: "user",
  parts: [
    ...files.map(([fileId, filename, mediaType]) => ({ type: "file" as const, url: `attachment:${fileId}`, filename, mediaType })),
    { type: "text" as const, text: "Смотри" },
  ],
});
const answer = (id: string): AgentChatMessage => ({ id, role: "assistant", parts: [{ type: "text", text: "Вижу" }] });

/** Как `describe` плагина вложений: картинка по типу файла, адрес на сервере. */
function describeAttachments(message: AgentChatMessage): MessageAttachmentsView | undefined {
  const items = message.parts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            id: part.url.slice("attachment:".length),
            name: part.filename ?? "файл",
            kind: part.mediaType.startsWith("image/") ? ("image" as const) : ("file" as const),
            url: `/api/chat/c1/attachments/${part.url.slice("attachment:".length)}`,
            mediaType: part.mediaType,
          },
        ]
      : [],
  );
  return items.length > 0 ? { label: "Вложения", items } : undefined;
}

describe("collectViewerItems: состав карусели", () => {
  it("картинки вложений человека по порядку ленты; файлы не попадают; key — id вложения, alt — имя файла", () => {
    const messages = [
      user("u1", [
        ["a", "кот.png", "image/png"],
        ["b", "счёт.pdf", "application/pdf"],
      ]),
      answer("m1"),
      user("u2", [["c", "пёс.jpg", "image/jpeg"]]),
    ];
    expect(collectViewerItems({ messages, describeAttachments })).toEqual([
      { kind: "image", key: "a", src: "/api/chat/c1/attachments/a", alt: "кот.png" },
      { kind: "image", key: "c", src: "/api/chat/c1/attachments/c", alt: "пёс.jpg" },
    ]);
  });

  it("без плагина вложений и без дополнительных элементов — пусто", () => {
    expect(collectViewerItems({ messages: [user("u1", [["a", "кот.png", "image/png"]])] })).toEqual([]);
  });

  it("extraItems встают на место своего сообщения в ленте (картинки агента — этап 5)", () => {
    const agentPicture: MediaViewerItem = { kind: "image", key: "g1", src: "/g1.png", alt: "закат над морем" };
    const messages = [user("u1", [["a", "кот.png", "image/png"]]), answer("m1"), user("u2", [["c", "пёс.jpg", "image/jpeg"]])];
    const items = collectViewerItems({
      messages,
      describeAttachments,
      extraItems: (message) => (message.id === "m1" ? [agentPicture] : []),
    });
    expect(items.map((item) => item.key)).toEqual(["a", "g1", "c"]);
  });

  it("describe спрашивается и у ответов агента: картинки импорта в ответе тоже идут в карусель", () => {
    const asked: string[] = [];
    collectViewerItems({
      messages: [user("u1", []), answer("m1")],
      describeAttachments: (message) => {
        asked.push(message.id);
        return undefined;
      },
    });
    expect(asked).toEqual(["u1", "m1"]);
  });

  it("одна и та же картинка дважды (одно вложение в двух сообщениях) — один элемент, первое место", () => {
    const messages = [user("u1", [["a", "кот.png", "image/png"]]), answer("m1"), user("u2", [["a", "кот.png", "image/png"]])];
    expect(collectViewerItems({ messages, describeAttachments }).map((item) => item.key)).toEqual(["a"]);
  });
});
