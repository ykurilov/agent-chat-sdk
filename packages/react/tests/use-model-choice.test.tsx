// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { russianLabels } from "../src/labels";
import { useModelChoice } from "../src/use-model-choice";
import type { UseModelChoiceOptions } from "../src/use-model-choice";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

function renderChoice(server: ReturnType<typeof fakeChatServer>, options: Partial<UseModelChoiceOptions> = {}) {
  return renderHook(
    (props: Partial<UseModelChoiceOptions>) =>
      useModelChoice({ api: "/api/chat", chatId: "c1", fetch: server.fetch, ...props }),
    { initialProps: options },
  );
}

const fireworksGlm = { providerId: "fireworks", modelId: "glm-5.3-flash", reasoning: "high" };

describe("useModelChoice", () => {
  it("грузит меню один раз: провайдеры, модели и названия уровней из надписей", async () => {
    const server = fakeChatServer();
    const { result } = renderChoice(server);
    expect(result.current.providers).toEqual([]);
    await waitFor(() => expect(result.current.providers.map((provider) => provider.id)).toEqual(["deepseek", "fireworks"]));
    expect(server.requestsTo("models")).toHaveLength(1);
    expect(result.current.providers[1]).toEqual({
      id: "fireworks",
      name: "Fireworks",
      models: [
        { id: "deepseek-4.1-flash", name: "DeepSeek 4.1 Flash" },
        { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
      ],
    });
    expect(result.current.error).toBeUndefined();
  });

  it("чат без сохранённого выбора показывает выбор по умолчанию: модель и уровень", async () => {
    const { result } = renderChoice(fakeChatServer());
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "deepseek", modelId: "deepseek-4.1-flash" });
    expect(result.current.reasoning).toBe("on");
    expect(result.current.reasoningLevels).toEqual([
      { id: "off", name: russianLabels.reasoningLevels.off },
      { id: "on", name: russianLabels.reasoningLevels.on },
    ]);
  });

  it("сохранённый выбор чата главнее выбора по умолчанию", async () => {
    const { result } = renderChoice(fakeChatServer(), { savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "fireworks", modelId: "glm-5.3-flash" });
    expect(result.current.reasoning).toBe("high");
    expect(result.current.reasoningLevels.map((level) => level.id)).toEqual(["low", "medium", "high"]);
  });

  it("пока выбор чата не пришёл с историей, выбор по умолчанию не показывается: сразу запомненный, без мигания", async () => {
    const server = fakeChatServer();
    const { result, rerender } = renderChoice(server, { savedChoicePending: true });
    await waitFor(() => expect(server.requestsTo("models")).toHaveLength(1));
    // Меню уже загружено, история ещё нет: ни модели по умолчанию, ни пустой кнопки с чужой моделью.
    await act(async () => {});
    expect(result.current.providers).toEqual([]);
    expect(result.current.current).toEqual({ providerId: "", modelId: "" });
    expect(result.current.error).toBeUndefined();

    rerender({ savedChoicePending: false, savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.current).toEqual({ providerId: "fireworks", modelId: "glm-5.3-flash" }));
    expect(result.current.reasoning).toBe("high");
  });

  it("история не пришла совсем (ожидание снято, выбора нет): показывается выбор по умолчанию", async () => {
    const { result, rerender } = renderChoice(fakeChatServer(), { savedChoicePending: true });
    rerender({ savedChoicePending: false });
    await waitFor(() => expect(result.current.current).toEqual({ providerId: "deepseek", modelId: "deepseek-4.1-flash" }));
  });

  it("выбор доходит из истории позже меню и меняет показанное", async () => {
    const { result, rerender } = renderChoice(fakeChatServer());
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    rerender({ savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.current.modelId).toBe("glm-5.3-flash"));
  });

  it("смена модели: PUT с моделью, провайдером и уровнем; выбор виден сразу", async () => {
    const server = fakeChatServer();
    const { result } = renderChoice(server);
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onChange({ providerId: "fireworks", modelId: "glm-5.3-flash" }));

    expect(result.current.current).toEqual({ providerId: "fireworks", modelId: "glm-5.3-flash" });
    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(1));
    expect(server.requestsTo("model")[0]).toMatchObject({
      method: "PUT",
      url: "/api/chat/c1/model",
      // у GLM нет «Вкл» — берётся его уровень по умолчанию
      body: { providerId: "fireworks", modelId: "glm-5.3-flash", reasoning: "medium" },
    });
    await waitFor(() => expect(result.current.reasoning).toBe("medium"));
  });

  it("при смене модели уровень остаётся, если он есть у новой модели", async () => {
    const server = fakeChatServer();
    const { result } = renderChoice(server, { savedChoice: { providerId: "deepseek", modelId: "deepseek-4.1-flash", reasoning: "off" } });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onChange({ providerId: "fireworks", modelId: "deepseek-4.1-flash" }));

    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(1));
    expect(server.requestsTo("model")[0]?.body).toMatchObject({ reasoning: "off" });
    expect(result.current.reasoning).toBe("off");
  });

  it("смена уровня: PUT с той же моделью и новым уровнем", async () => {
    const server = fakeChatServer();
    const { result } = renderChoice(server, { savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onReasoningChange("low"));

    expect(result.current.reasoning).toBe("low");
    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(1));
    expect(server.requestsTo("model")[0]?.body).toEqual({ providerId: "fireworks", modelId: "glm-5.3-flash", reasoning: "low" });
  });

  it("сервер отказал: выбор откатывается, показана надпись «не удалось сменить модель»", async () => {
    const server = fakeChatServer();
    server.state.fail.add("model");
    const { result } = renderChoice(server, { savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onChange({ providerId: "deepseek", modelId: "deepseek-4.1-flash" }));

    await waitFor(() => expect(result.current.error).toBe(russianLabels.modelChoiceFailed));
    expect(result.current.current).toEqual({ providerId: "fireworks", modelId: "glm-5.3-flash" });
    expect(result.current.reasoning).toBe("high");
  });

  it("следующая удачная смена убирает надпись об ошибке", async () => {
    const server = fakeChatServer();
    server.state.fail.add("model");
    const { result } = renderChoice(server, { savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    act(() => result.current.onReasoningChange("low"));
    await waitFor(() => expect(result.current.error).toBe(russianLabels.modelChoiceFailed));

    server.state.fail.delete("model");
    act(() => result.current.onReasoningChange("medium"));
    await waitFor(() => expect(result.current.error).toBeUndefined());
    expect(result.current.reasoning).toBe("medium");
  });

  it("быстрые смены подряд: остаётся последняя, откат при отказе идёт к последнему сохранённому", async () => {
    const server = fakeChatServer();
    const { result } = renderChoice(server, { savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onReasoningChange("low"));
    act(() => result.current.onReasoningChange("medium"));

    await waitFor(() => expect(server.requestsTo("model")).toHaveLength(2));
    await waitFor(() => expect(server.state.chatChoice?.reasoning).toBe("medium"));
    expect(result.current.reasoning).toBe("medium");
  });

  it("список не загрузился: меню пусто, надпись «список моделей не загрузился»", async () => {
    const server = fakeChatServer();
    server.state.fail.add("models");
    const { result } = renderChoice(server);
    await waitFor(() => expect(result.current.error).toBe(russianLabels.modelMenuFailed));
    expect(result.current.providers).toEqual([]);
  });

  it("сохранённой модели нет в меню: показывается выбор по умолчанию", async () => {
    const { result } = renderChoice(fakeChatServer(), { savedChoice: { providerId: "gone", modelId: "gone" } });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "deepseek", modelId: "deepseek-4.1-flash" });
  });
});

describe("useModelChoice: картинки", () => {
  it("модели несут признак «видит картинки», если сервер его прислал", async () => {
    const server = fakeChatServer();
    server.state.menu = {
      ...(server.state.menu as object),
      providers: [{ id: "p", displayName: "P", models: [{ id: "m", displayName: "M", acceptsImages: true, reasoning: { levels: [], defaultLevel: null } }] }],
      defaultChoice: { modelId: "m", providerId: "p", reasoning: null },
    };
    const { result } = renderChoice(server);
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.providers[0]!.models).toEqual([{ id: "m", name: "M", acceptsImages: true }]);
  });
});

describe("useModelChoice: текущий выбор не из списка (скрытый провайдер)", () => {
  const menuWithHiddenDefault = (details?: Record<string, unknown>) => ({
    providers: [
      { id: "deepseek", displayName: "DeepSeek", models: [{ id: "deepseek-4.1-flash", displayName: "DeepSeek 4.1 Flash", reasoning: { levels: ["off", "on"], defaultLevel: "on" } }] },
    ],
    defaultChoice: { modelId: "hidden-model", providerId: "hidden", reasoning: "high", ...(details && { details }) },
  });

  it("выбор по умолчанию скрытого провайдера показывается как текущий: название, картинки, уровни — из details", async () => {
    const server = fakeChatServer();
    server.state.menu = menuWithHiddenDefault({
      providerName: "Скрытый",
      modelName: "Скрытая модель",
      acceptsImages: true,
      reasoning: { levels: ["low", "high"], defaultLevel: "low" },
    });
    const { result } = renderChoice(server);
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "hidden", modelId: "hidden-model" });
    expect(result.current.providers.find((provider) => provider.id === "hidden")).toEqual({
      id: "hidden",
      name: "Скрытый",
      models: [{ id: "hidden-model", name: "Скрытая модель", acceptsImages: true }],
    });
    expect(result.current.reasoning).toBe("high");
    expect(result.current.reasoningLevels.map((level) => level.id)).toEqual(["low", "high"]);
    expect(result.current.error).toBeUndefined();
  });

  it("без details: текущий показан по id, уровней нет, состояние не пустое и не сломано", async () => {
    const server = fakeChatServer();
    server.state.menu = menuWithHiddenDefault();
    const { result } = renderChoice(server);
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "hidden", modelId: "hidden-model" });
    expect(result.current.providers.find((provider) => provider.id === "hidden")?.models).toEqual([{ id: "hidden-model", name: "hidden-model" }]);
    expect(result.current.reasoningLevels).toEqual([]);
    expect(result.current.reasoning).toBe("");
    expect(result.current.error).toBeUndefined();
  });

  it("сохранённый в чате скрытый выбор, которого нет в меню, заменяется выбором по умолчанию; вернуться на скрытого нельзя", async () => {
    const server = fakeChatServer();
    server.state.menu = menuWithHiddenDefault();
    const { result } = renderChoice(server, { savedChoice: { providerId: "other-hidden", modelId: "x" } });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(result.current.current).toEqual({ providerId: "hidden", modelId: "hidden-model" });
    act(() => result.current.onChange({ providerId: "hidden", modelId: "hidden-model" }));
    expect(server.requestsTo("model")).toHaveLength(0);
  });
});

describe("useModelChoice: onModelChosen", () => {
  it("зовётся с сохранённым выбором, когда человек сменил модель или уровень в меню", async () => {
    const server = fakeChatServer();
    const onModelChosen = vi.fn();
    const { result } = renderChoice(server, { savedChoice: fireworksGlm, onModelChosen });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    expect(onModelChosen).not.toHaveBeenCalled();

    act(() => result.current.onReasoningChange("low"));
    await waitFor(() => expect(onModelChosen).toHaveBeenCalledTimes(1));
    expect(onModelChosen).toHaveBeenLastCalledWith({ providerId: "fireworks", modelId: "glm-5.3-flash", reasoning: "low" });

    act(() => result.current.onChange({ providerId: "deepseek", modelId: "deepseek-4.1-flash" }));
    await waitFor(() => expect(onModelChosen).toHaveBeenCalledTimes(2));
    expect(onModelChosen.mock.lastCall?.[0]).toMatchObject({ providerId: "deepseek", modelId: "deepseek-4.1-flash" });
  });

  it("выбор по умолчанию, выбор из истории и отказ сервера его не зовут", async () => {
    const server = fakeChatServer();
    const onModelChosen = vi.fn();
    const { result, rerender } = renderChoice(server, { onModelChosen });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));
    rerender({ onModelChosen, savedChoice: fireworksGlm });
    await waitFor(() => expect(result.current.current.modelId).toBe("glm-5.3-flash"));

    server.state.fail.add("model");
    act(() => result.current.onReasoningChange("low"));
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(onModelChosen).not.toHaveBeenCalled();
  });

  it("сбой колбэка не откатывает сохранённый выбор и не показывает ошибку сохранения: ошибка — в консоль", async () => {
    const server = fakeChatServer();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onModelChosen = vi.fn(() => {
      throw new Error("колбэк приложения упал");
    });
    const { result } = renderChoice(server, { savedChoice: fireworksGlm, onModelChosen });
    await waitFor(() => expect(result.current.providers).not.toEqual([]));

    act(() => result.current.onReasoningChange("low"));
    await waitFor(() => expect(onModelChosen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "колбэк приложения упал" })));
    expect(result.current.error).toBeUndefined();
    expect(result.current.reasoning).toBe("low");
    consoleError.mockRestore();
  });
});
