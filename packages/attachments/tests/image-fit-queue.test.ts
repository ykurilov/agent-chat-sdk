import { availableParallelism } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { fitImageForModel } from "../src/fit-image";
import { defaultAttachmentLimits } from "../src/limits";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { makePng } from "./support/sample-files";

vi.mock("../src/fit-image", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/fit-image")>();
  return { ...original, fitImageForModel: vi.fn(original.fitImageForModel) };
});

/** Ужатие, которое считает, сколько ужатий идёт разом, и думает 20 мс. */
function countingFits() {
  const seen = { running: 0, most: 0, calls: 0 };
  vi.mocked(fitImageForModel).mockImplementation(async (bytes, mediaType) => {
    seen.calls += 1;
    seen.running += 1;
    seen.most = Math.max(seen.most, seen.running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    seen.running -= 1;
    return { bytes, mediaType, width: 2, height: 2, changed: false };
  });
  return seen;
}

function uploader(limits: Parameters<typeof createAttachments>[0]["limits"]) {
  const attachments = createAttachments({ storage: createMemoryAttachmentStorage(), limits });
  return (userId: string, name: string) => {
    const form = new FormData();
    form.set("file", new File([makePng(2, [0, 255, 0]) as BlobPart], name));
    return attachments.handle({ request: new Request("http://x/a", { method: "POST", body: form }), userId, chatId: "chat-1", segments: [] });
  };
}

describe("ужатие картинок при загрузке идёт через ограниченную очередь", () => {
  it("много картинок разом: ужимаются не больше заданного числа одновременно, остальные ждут и тоже принимаются", async () => {
    const seen = countingFits();
    const send = uploader({ maxParallelImageFits: 2, maxParallelUploadsPerUser: 8, maxParallelUploads: 8 });

    const responses = await Promise.all(["anna", "boris", "vera"].flatMap((userId) => [send(userId, "1.png"), send(userId, "2.png")]));

    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
    expect(seen.calls).toBe(6);
    expect(seen.most).toBe(2);
  });

  it("упавшее ужатие не занимает место в очереди", async () => {
    const seen = countingFits();
    vi.mocked(fitImageForModel).mockRejectedValueOnce(new Error("sharp упал"));
    const send = uploader({ maxParallelImageFits: 1 });

    await send("anna", "1.png").catch(() => null);
    expect((await send("anna", "2.png")).status).toBe(201);
    expect(seen.calls).toBe(1);
  });

  it("по умолчанию — половина ядер процессора, не меньше одного", () => {
    expect(defaultAttachmentLimits.maxParallelImageFits).toBe(Math.max(1, Math.floor(availableParallelism() / 2)));
  });
});
