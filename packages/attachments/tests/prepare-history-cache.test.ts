import type { AgentChatMessage, ModelProfile } from "@ykurilov/agent-chat-core";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { fitImageForModel } from "../src/fit-image";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { defaultAttachmentLimits } from "../src/limits";
import { prepareHistory } from "../src/prepare-history";
import type { StoredAttachment } from "../src/attachment-storage";

vi.mock("../src/fit-image", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/fit-image")>();
  return { ...original, fitImageForModel: vi.fn(original.fitImageForModel) };
});

const seeing = { id: "see", acceptsImages: true } as ModelProfile;
const base = { chatId: "chat-1", ownerId: "anna", createdAt: "2026-01-01T00:00:00.000Z", attached: true, kind: "image" as const };

async function twoRequests(item: StoredAttachment, bytes: Uint8Array) {
  const storage = createMemoryAttachmentStorage();
  await storage.save(item, bytes);
  const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "file", url: `attachment:${item.id}`, mediaType: item.mediaType, filename: item.name }] }];
  const run = () => prepareHistory({ storage, chatId: "chat-1", history, model: { profile: seeing, providerId: "p" } });
  vi.mocked(fitImageForModel).mockClear();
  const first = await run();
  const second = await run();
  return { first, second, fits: vi.mocked(fitImageForModel).mock.calls.length };
}

describe("старые картинки ужимаются один раз, а не на каждом запросе", () => {
  it("большая старая картинка: два запроса — одно ужатие, побайтно один и тот же результат", async () => {
    const big = new Uint8Array(await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#4080c0" } }).jpeg().toBuffer());
    const { first, second, fits } = await twoRequests({ ...base, id: crypto.randomUUID(), name: "старое.jpg", mediaType: "image/jpeg", size: big.length }, big);
    expect(fits).toBe(1);
    expect(second).toEqual(first);
  });

  it("битая старая картинка: пометка запоминается, второй раз байты не разбираются", async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
    const { first, second, fits } = await twoRequests({ ...base, id: crypto.randomUUID(), name: "битая.jpg", mediaType: "image/jpeg", size: broken.length }, broken);
    expect(fits).toBe(1);
    expect(second).toEqual(first);
    expect(first[0]!.parts[0]).toEqual({ type: "text", text: "[Картинка «битая.jpg» пропущена: её не удалось прочитать.]" });
  });

  it("в чате 25 старых больших картинок: каждая ужимается один раз, а не по кругу на каждом запросе", async () => {
    const storage = createMemoryAttachmentStorage();
    const parts: AgentChatMessage["parts"] = [];
    for (let index = 0; index < 25; index += 1) {
      const wide = new Uint8Array(await sharp({ create: { width: 2100, height: 8, channels: 3, background: { r: index, g: 0, b: 0 } } }).png().toBuffer());
      const item = { ...base, id: crypto.randomUUID(), name: `старое-${index}.png`, mediaType: "image/png", size: wide.length };
      await storage.save(item, wide);
      parts.push({ type: "file", url: `attachment:${item.id}`, mediaType: item.mediaType, filename: item.name });
    }
    const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts }];
    const run = () => prepareHistory({ storage, chatId: "chat-1", history, model: { profile: seeing, providerId: "p" } });
    vi.mocked(fitImageForModel).mockClear();

    const first = await run();
    const second = await run();

    expect(vi.mocked(fitImageForModel).mock.calls).toHaveLength(25);
    expect(second).toEqual(first);
  });

  it("память под ужатые копии — настройка `limits.imageCacheBytes`: 0 — копии не запоминаются, по умолчанию 128 МБ", async () => {
    const big = new Uint8Array(await sharp({ create: { width: 2100, height: 8, channels: 3, background: "#4080c0" } }).png().toBuffer());
    const fitsWith = async (limits: { imageCacheBytes?: number }) => {
      const storage = createMemoryAttachmentStorage();
      const item = { ...base, id: crypto.randomUUID(), name: "старое.png", mediaType: "image/png", size: big.length };
      await storage.save(item, big);
      const attachments = createAttachments({ storage, limits });
      const history: AgentChatMessage[] = [{ id: "u1", role: "user", parts: [{ type: "file", url: `attachment:${item.id}`, mediaType: item.mediaType, filename: item.name }] }];
      vi.mocked(fitImageForModel).mockClear();
      for (let request = 0; request < 2; request += 1) {
        await attachments.prepareHistory({ chatId: "chat-1", history, model: { profile: seeing, providerId: "p" } });
      }
      return vi.mocked(fitImageForModel).mock.calls.length;
    };

    expect(await fitsWith({ imageCacheBytes: 0 })).toBe(2);
    expect(await fitsWith({})).toBe(1);
    expect(defaultAttachmentLimits.imageCacheBytes).toBe(128 * 1024 * 1024);
  });
});
