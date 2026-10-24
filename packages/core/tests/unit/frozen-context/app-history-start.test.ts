import { describe, expect, it, vi } from "vitest";
import { freezeContext } from "../../../src/frozen-context/freeze-context";

const app = [{ key: "profile", text: "Профиль A", private: true }];
const first = () => freezeContext({ chatId: "c", appContextFrom: "u1", sources: { today: "Сегодня", app: async () => app }, base: null });

describe("снимок приложения использует тот же read/fallback по началу истории", () => {
  it("не читает изменившийся источник, пока начало то же; смена начала перечитывает", async () => {
    const base = { id: "a1", data: await first() };
    const source = vi.fn(async () => [{ key: "profile", text: "Профиль B" }]);
    const kept = await freezeContext({ chatId: "c", appContextFrom: "u1", sources: { today: "Сегодня", app: source }, base });
    expect(source).not.toHaveBeenCalled();
    expect(kept.blocks).toEqual(base.data.blocks);
    expect(kept.sent).toEqual({ changed: [], removed: [] });
    expect(kept.appContextFrom).toBe("u1");
    const reset = await freezeContext({ chatId: "c", appContextFrom: "summary", sources: { today: "Сегодня", app: source }, base });
    expect(source).toHaveBeenCalledTimes(1);
    expect(reset.sent).toEqual({ changed: ["profile"], removed: [] });
    expect(reset.appContextFrom).toBe("summary");
  });

  it.each([{ empty: [] }, { empty: null }, { empty: undefined }])("успешный пустой ответ $empty фиксируется и не перечитывается", async ({ empty }) => {
    const source = vi.fn(async () => empty);
    const data = await freezeContext({ chatId: "c", appContextFrom: "u1", sources: { today: "Сегодня", app: source }, base: null });
    const next = await freezeContext({ chatId: "c", appContextFrom: "u1", sources: { today: "Сегодня", app: source }, base: { id: "a1", data } });
    expect(source).toHaveBeenCalledTimes(1);
    expect(next.appContextFrom).toBe("u1");
  });

  it("сбой при новом начале сохраняет блоки, но не подтверждает новое начало; следующая сборка пробует снова", async () => {
    const base = { id: "a1", data: await first() };
    const source = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(app);
    const failed = await freezeContext({ chatId: "c", appContextFrom: "summary", sources: { today: "Сегодня", app: source }, base, logError: vi.fn() });
    expect(failed.blocks).toEqual(base.data.blocks);
    expect(failed).not.toHaveProperty("appContextFrom");
    const next = await freezeContext({ chatId: "c", appContextFrom: "summary", sources: { today: "Сегодня", app: source }, base: { id: "a2", data: failed } });
    expect(source).toHaveBeenCalledTimes(2);
    expect(next.appContextFrom).toBe("summary");
  });

  it("обычный режим не переносит прежнюю отметку; повторное включение требует свежего чтения", async () => {
    const source = vi.fn(async () => app);
    const turn = await freezeContext({ chatId: "c", sources: { today: "Сегодня", app: source }, base: { id: "a1", data: await first() } });
    expect(turn).not.toHaveProperty("appContextFrom");
    await freezeContext({ chatId: "c", appContextFrom: "u1", sources: { today: "Сегодня", app: source }, base: { id: "a2", data: turn } });
    expect(source).toHaveBeenCalledTimes(2);
  });
});
