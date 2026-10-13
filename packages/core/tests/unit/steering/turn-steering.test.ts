import { describe, expect, it } from "vitest";
import { newStoredMessage } from "../../../src/conversation/types";
import type { AgentChatMessage, StoredMessage } from "../../../src/conversation/types";
import { createTurnSteering, isCorrection, steerPart, withCorrectionsJoined } from "../../../src/steering/turn-steering";

const written = (id: string) => async (parentId: string): Promise<StoredMessage> =>
  newStoredMessage({ id, chatId: "c", parentId, role: "user", parts: [{ type: "text", text: id }, steerPart()] });

describe("поправки хода", () => {
  it("принимаются по очереди: каждая — ребёнок предыдущей, первая — ребёнок ответа", async () => {
    const steering = createTurnSteering();
    const turn = steering.begin("c", "a1");
    expect(turn.waiting()).toBe(false);
    const [first, second] = await Promise.all([steering.accept("c", written("p1")), steering.accept("c", written("p2"))]);
    expect([first?.parentId, second?.parentId]).toEqual(["a1", "p1"]);
    expect(turn.waiting()).toBe(true);
    expect(turn.close()).toBe(2);
    expect((await turn.settled()).map((message) => message.id)).toEqual(["p1", "p2"]);
  });

  it("приём закрыт или хода нет — null; поправка, которая уже пишется, достаётся закрытому ходу", async () => {
    const steering = createTurnSteering();
    expect(await steering.accept("c", written("p0"))).toBeNull();
    const turn = steering.begin("c", "a1");
    let release!: () => void;
    const slow = steering.accept("c", async (parentId) => {
      await new Promise<void>((resolve) => (release = resolve));
      return written("p1")(parentId);
    });
    const queued = steering.accept("c", written("p2"));
    await Promise.resolve();
    expect(turn.close()).toBe(1);
    expect(steering.isOpen("c")).toBe(false);
    release();
    expect((await slow)?.id).toBe("p1");
    expect(await queued).toBeNull();
    expect((await turn.settled()).map((message) => message.id)).toEqual(["p1"]);
  });

  it("поправка, которая ещё пишется, ход не останавливает: сорвётся запись — оборванного ответа не будет", async () => {
    const steering = createTurnSteering();
    const turn = steering.begin("c", "a1");
    let fail!: (error: Error) => void;
    const failing = steering.accept("c", () => new Promise<StoredMessage>((_resolve, reject) => (fail = reject)));
    await Promise.resolve();
    await Promise.resolve();
    expect(turn.waiting()).toBe(false);
    fail(new Error("файл не принят"));
    await expect(failing).rejects.toThrow("файл не принят");
    expect(turn.waiting()).toBe(false);
    await steering.accept("c", written("p2"));
    expect(turn.waiting()).toBe(true);
  });

  it("запись не удалась — поправки нет, следующая встаёт на её место", async () => {
    const steering = createTurnSteering();
    const turn = steering.begin("c", "a1");
    await expect(steering.accept("c", async () => Promise.reject(new Error("база")))).rejects.toThrow("база");
    expect(turn.waiting()).toBe(false);
    expect((await steering.accept("c", written("p2")))?.parentId).toBe("a1");
  });

  it("новый ход чата открывает свой приём: поправки идут к новому ответу", async () => {
    const steering = createTurnSteering();
    steering.begin("c", "a1").close();
    steering.begin("c", "a2");
    expect((await steering.accept("c", written("p1")))?.parentId).toBe("a2");
  });
});

describe("поправки в запросе к модели", () => {
  const user = (id: string, text: string, correction = false): AgentChatMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text }, ...(correction ? [steerPart()] : [])],
  });
  const answer: AgentChatMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "делаю" }] };

  it("поправки подряд — одно сообщение человека, вторая через пустую строку, без отметок", () => {
    const joined = withCorrectionsJoined([user("u1", "сделай сайт"), answer, user("p1", "синим", true), user("p2", "и крупнее", true)]);
    expect(joined.map((message) => message.id)).toEqual(["u1", "a1", "p1"]);
    expect(joined[2]!.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["синим", "\n\nи крупнее"]);
    expect(isCorrection(joined[2]!)).toBe(true);
  });

  it("обычные сообщения подряд не сливаются: их размечает пометка «ответа нет»", () => {
    const history = [user("u1", "раз"), user("u2", "два"), answer, user("p1", "синим", true), user("u3", "ещё")];
    expect(withCorrectionsJoined(history)).toEqual(history);
  });
});
