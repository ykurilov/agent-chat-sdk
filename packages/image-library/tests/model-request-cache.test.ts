import { createChatService } from "../../core/src/chat-service";
import { createInMemoryChatStorage } from "../../core/src/storage/in-memory-storage";
import { describe, expect, it } from "vitest";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "../../core/tests/unit/support/mock-model";
import { createImageLibrary } from "../src/index";
import type { ImageEntry } from "../src/index";

type LanguageModelV4StreamPart = Parameters<typeof streamOf>[0][number];

const cell: ImageEntry = { id: "cell", title: "Строение клетки", alt: "Схема клетки", url: "/library/cell.png", width: 1200, height: 800 };
const atom: ImageEntry = { id: "atom", title: "Модель атома", alt: "Ядро и электроны", url: "/library/atom.png", width: 640, height: 640 };

const call = (id: string, toolName: string, input: unknown): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];

/** Модель по сценарию: ход 1 — ищет и показывает клетку; ход 2 — ищет и показывает атом (добавлен между ходами). */
function scriptedModel(scripts: LanguageModelV4StreamPart[][]) {
  let index = 0;
  return mockModel(() => streamOf(scripts[index++] ?? [streamStart, ...textParts(["Готово"]), finishPart()]));
}

describe("запрос к модели с библиотекой картинок", () => {
  it("инструменты побайтно те же от хода к ходу, хотя каталог вырос; начало запроса второго хода — запрос первого", async () => {
    const live: ImageEntry[] = [cell];
    const library = createImageLibrary({ images: () => live });
    const model = scriptedModel([
      call("f1", "find_images", { query: "клетка" }),
      call("s1", "show_image", { id: "cell" }),
      [streamStart, ...textParts(["Вот клетка."]), finishPart()],
      call("f2", "find_images", { query: "атом" }),
      call("s2", "show_image", { id: "atom" }),
    ]);
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты учитель.", tools: (choice) => library.tools(choice) },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Покажи клетку" }] }));
    live.push(atom);
    await readAll(await service.sendMessage("anna", chat.id, { id: "u2", role: "user", parts: [{ type: "text", text: "А атом?" }] }));

    const calls = model.doStreamCalls;
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const tools = calls.map((request) => JSON.stringify(request.tools));
    expect(new Set(tools).size).toBe(1);
    expect(tools[0]).not.toContain("клетк");

    // Модель видит после показа только «показано: название» — без адреса и размеров.
    const afterShow = JSON.stringify(calls[2]!.prompt);
    expect(afterShow).toContain("показано");
    expect(afterShow).not.toContain("/library/cell.png");

    // Второй ход начинается с того же, что видела модель в конце первого: кэш модели цел.
    const firstTurnEnd = JSON.stringify(calls[2]!.prompt).slice(0, -1);
    expect(JSON.stringify(calls[3]!.prompt).startsWith(firstTurnEnd)).toBe(true);

    const { messages } = await service.getHistory("anna", chat.id);
    const shown = messages.flatMap((message) => message.parts).filter((part) => part.type === "tool-show_image");
    expect(shown.map((part) => (part as { output: { картинка: { id: string } } }).output.картинка.id)).toEqual(["cell", "atom"]);
  });

  it("id не из каталога: в истории — неудача вызова с текстом, модель на следующем шаге видит тот же текст", async () => {
    const library = createImageLibrary({ images: [cell] });
    const model = scriptedModel([call("s1", "show_image", { id: "/library/secret.png" })]);
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты учитель.", tools: (choice) => library.tools(choice) },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "Покажи секрет" }] }));

    const { messages } = await service.getHistory("anna", chat.id);
    const part = messages.flatMap((message) => message.parts).find((item) => item.type === "tool-show_image") as { state: string; errorText?: string };
    expect(part.state).toBe("output-error");
    expect(part.errorText).toMatch(/Такой картинки нет в каталоге/);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("Такой картинки нет в каталоге");
  });
});
