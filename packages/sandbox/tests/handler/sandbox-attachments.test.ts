import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { SpendingLimits, UsageRecord } from "@ykurilov/agent-chat-core";
import { createImageGeneration } from "@ykurilov/agent-chat-images";
import { jsonSchema, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { appInstructions, sandboxBase, setupSandbox } from "./support/sandbox-setup";

/** Начало настоящего PNG: по нему вложения узнают картинку. */
const pngBytes = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 32 }, (_, index) => index)]);

/** Поддельный Runware: задача отвечает готовой картинкой за 0,01 $, скачивание — байтами PNG. Платных вызовов нет. */
const fakeRunware = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (init?.method === "POST") return Response.json({ data: [{ taskType: "imageInference", imageURL: "https://im.runware.ai/image/1.png", cost: 0.01 }] });
  return new Response(pngBytes() as BodyInit);
});

/**
 * Песочница с картинками и вложениями. `battleLimitReached` — лимит приложения исчерпан у боевой Анны (`anna`).
 * Инструмент `who_am_i` показывает, какой id получают прочие инструменты приложения.
 */
function withImages(options: { battleLimitReached?: boolean } = {}) {
  const attachments = createAttachments({ storage: createMemoryAttachmentStorage() });
  const usage: UsageRecord[] = [];
  const limitChecks: string[] = [];
  const limits: Pick<SpendingLimits, "assertWithinLimit"> = {
    assertWithinLimit: async ({ userId }) => {
      limitChecks.push(userId);
      if (options.battleLimitReached && userId === "anna") throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null });
    },
  };
  const images = createImageGeneration({
    attachments,
    env: { RUNWARE_API_KEY: "rw-key-0123456789" },
    fetch: fakeRunware as typeof fetch,
    spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) }, limits },
  });
  const toolOwners: string[] = [];
  const whoAmI = (ownerId: string) =>
    tool({ description: "Кто я.", inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => ({ ownerId }) });
  const setup = setupSandbox({
    steps: [
      { toolCall: { id: "img-1", name: "generate_images", input: { prompt: "Маяк на скале", count: 1, aspectRatio: "1:1" } } },
      { toolCall: { id: "who-1", name: "who_am_i", input: {} } },
      { text: "готово" },
    ],
    chat: {
      attachments,
      agent: {
        instructions: appInstructions,
        tools: (model) => {
          toolOwners.push(model.ownerId);
          return { ...images.tools(model), who_am_i: whoAmI(model.ownerId) };
        },
      },
    },
  });
  return { setup, usage, limitChecks, toolOwners };
}

/** Результат вызова инструмента из журнала песочницы. */
async function toolOutput(setup: ReturnType<typeof setupSandbox>, chatId: string, name: string) {
  for (const entry of await setup.journal.listForChat(chatId)) {
    if (entry.kind !== "tool") continue;
    const details = await setup.journal.getCall(entry.id);
    if (details?.kind === "tool" && details.call.toolName === name) return details.output?.content;
  }
  return undefined;
}

const download = (setup: ReturnType<typeof setupSandbox>, chatId: string, id: string, user: string | null) =>
  setup.call("GET", `/${chatId}/attachments/${id}`, { user });

describe("песочница: вложения принадлежат песочному чату", () => {
  it("картинка generate_images открывается владельцем-админом; второй админ и не-админ — 404", async () => {
    const { setup } = withImages();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "нарисуй маяк");
    const output = (await toolOutput(setup, chatId, "generate_images")) as { создано: number; картинки: Array<{ id: string }> };
    expect(output.создано).toBe(1);
    const imageId = output.картинки[0]!.id;

    const own = await download(setup, chatId, imageId, "anna");
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/png");
    expect((await download(setup, chatId, imageId, "boris")).status).toBe(404);
    expect((await download(setup, chatId, imageId, "vera")).status).toBe(404);
    expect((await download(setup, chatId, imageId, null)).status).toBe(404);
  });

  it("прочие инструменты приложения по-прежнему получают настоящий id админа", async () => {
    const { setup, toolOwners } = withImages();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "нарисуй маяк");
    expect(await toolOutput(setup, chatId, "who_am_i")).toEqual({ ownerId: "anna" });
    expect(toolOwners).toContain("anna");
  });

  it("файл, загруженный админом в песочный чат, открывается им и уходит в сообщение; второй админ и не-админ — 404", async () => {
    const { setup } = withImages();
    const chatId = await setup.createChat("anna");
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode("заметка")], "note.txt", { type: "text/plain" }));
    const uploaded = await setup.sandbox.fetch(
      new Request(`${sandboxBase}/${chatId}/attachments`, { method: "POST", headers: { "x-user": "anna" }, body: form }),
    );
    expect(uploaded.status).toBe(201);
    const { id } = (await uploaded.json()) as { id: string };

    expect((await download(setup, chatId, id, "anna")).status).toBe(200);
    expect((await download(setup, chatId, id, "boris")).status).toBe(404);
    expect((await download(setup, chatId, id, "vera")).status).toBe(404);

    const sent = await setup.call("POST", `/${chatId}/messages`, {
      body: { message: { id: "m-file", role: "user", parts: [{ type: "text", text: "прочти" }, { type: "file", url: `attachment:${id}`, mediaType: "text/plain", filename: "note.txt" }] } },
    });
    expect(sent.status).toBe(200);
    await sent.text();
  });
});

describe("песочница: траты на картинки отдельно от боевых", () => {
  it("лимит и запись расхода — на песочного владельца, боевой лимит админа не мешает и не растёт", async () => {
    const { setup, usage, limitChecks } = withImages({ battleLimitReached: true });
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "нарисуй маяк");
    const output = (await toolOutput(setup, chatId, "generate_images")) as { создано: number };
    expect(output.создано).toBe(1);
    expect(limitChecks).toEqual(["sandbox:anna"]);
    expect(usage).toEqual([expect.objectContaining({ ownerId: "sandbox:anna", chatId, costUsd: 0.01 })]);
  });
});
