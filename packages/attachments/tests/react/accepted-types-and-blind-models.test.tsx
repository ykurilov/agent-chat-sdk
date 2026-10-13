// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { russianAttachmentsLabels } from "../../src/react/labels";
import { useAttachmentsController } from "../../src/react/use-attachments-controller";

function setup(settings: Record<string, unknown>, modelSeesImages: boolean | undefined) {
  const posted: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/attachments/settings")) return Response.json(settings);
    const file = (init!.body as FormData).get("file") as File;
    posted.push(file.name);
    return Response.json({ id: `id-${posted.length}`, name: file.name, mediaType: file.type, kind: "image", size: file.size }, { status: 201 });
  }) as unknown as typeof globalThis.fetch;
  const hook = renderHook(() => useAttachmentsController({ api: "/api/chat", chatId: "c1", fetch, modelSeesImages }, russianAttachmentsLabels));
  return { posted, ...hook };
}

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("допустимые типы из настроек сервера", () => {
  const settings = { maxFiles: 5, maxFileBytes: 1000, maxMessageTextTokens: 100, accept: "image/png,.png", acceptedMediaTypes: ["image/png"] };

  it("файл чужого типа (в том числе из буфера) — ошибка unsupported_type сразу, на сервер не уходит", async () => {
    const { result, posted } = setup(settings, true);
    await waitFor(() => expect(result.current.composer.accept).toBe("image/png,.png"));
    await act(async () => result.current.composer.onAddFiles([file("doc.pdf", "application/pdf"), file("ok.png", "image/png")]));
    await waitFor(() => expect(posted).toEqual(["ok.png"]));
    expect(result.current.composer.items.map((item) => [item.name, item.status])).toEqual([
      ["doc.pdf", "error"],
      ["ok.png", "ready"],
    ]);
    expect(result.current.composer.notice).toContain(russianAttachmentsLabels.errors.unsupported_type);
  });

  it("тип, который браузер не назвал, и файл без расширения проверяет сервер", async () => {
    const { result, posted } = setup(settings, true);
    await waitFor(() => expect(result.current.composer.accept).toBe("image/png,.png"));
    await act(async () => result.current.composer.onAddFiles([file("без-типа", "")]));
    await waitFor(() => expect(posted).toEqual(["без-типа"]));
  });

  it("другое имя того же типа и расширение: image/x-png, image/jpg, пустой тип с подходящим расширением проходят; пустой тип с чужим — нет", async () => {
    const jpegAndPng = { ...settings, accept: "image/png,image/jpeg,.png,.jpg,.jpeg", acceptedMediaTypes: ["image/png", "image/jpeg"] };
    const { result, posted } = setup(jpegAndPng, true);
    await waitFor(() => expect(result.current.composer.accept).toBe(jpegAndPng.accept));
    await act(async () =>
      result.current.composer.onAddFiles([
        file("a.png", "image/x-png"),
        file("b.jpg", "image/jpg"),
        file("c.JPEG", ""),
        file("d.png", "application/octet-stream"),
        file("e.pdf", ""),
      ]),
    );
    await waitFor(() => expect(posted.sort()).toEqual(["a.png", "b.jpg", "c.JPEG", "d.png"]));
    expect(result.current.composer.items.find((item) => item.name === "e.pdf")?.status).toBe("error");
  });
});

describe("режим плашки для моделей без зрения", () => {
  it("сервер говорит imagesForBlindModels — предупреждения «модель не видит картинки» нет", async () => {
    const { result } = setup({ imagesForBlindModels: true }, false);
    await act(async () => result.current.composer.onAddFiles([file("shot.png", "image/png")]));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.composer.notice).toBeUndefined();
  });
});
