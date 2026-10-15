import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import {
  checkProviderFallback,
  decideNextAttempt,
  errorKindForPerson,
  fallbackProviders,
  nextSilenceProvider,
  resolveSilenceSwitch,
} from "../../../src/agent-run/next-attempt";
import type { ProviderFallbackSetting } from "../../../src/agent-run/next-attempt";
import type { AttemptResult } from "../../../src/agent-run/turn-attempt";
import type { ChatErrorKind } from "../../../src/conversation/types";
import type { ModelCatalog, ProviderDescription } from "../../../src/models/model-catalog";
import { FirstChunkTimeoutError, StreamStallError } from "../../../src/provider-errors/transient-retry-middleware";

const provider = (id: string): ProviderDescription => ({
  id,
  displayName: id,
  apiKeyEnv: `${id.toUpperCase()}_KEY`,
  createLanguageModel: () => {
    throw new Error("в этих тестах модель не нужна");
  },
  requestOptions: () => ({}),
});

/** Модель «m» у четырёх провайдеров; ключ на сервере у трёх (у «d» нет). */
const catalog: ModelCatalog = {
  providers: ["a", "b", "c", "d"].map(provider),
  models: [
    {
      id: "m",
      displayName: "M",
      contextWindowTokens: 1000,
      acceptsImages: false,
      reasoning: { replayPastTurns: true },
      providerModelIds: { a: "m-a", b: "m-b", c: "m-c", d: "m-d" },
    },
    {
      id: "other",
      displayName: "Other",
      contextWindowTokens: 1000,
      acceptsImages: false,
      reasoning: { replayPastTurns: true },
      providerModelIds: { a: "o-a", b: "o-b" },
    },
  ],
};
const env = { A_KEY: "ключ-a", B_KEY: "ключ-b", C_KEY: "ключ-c" };

const candidates = (chosenProviderId: string, setting?: Parameters<typeof fallbackProviders>[0]["setting"], modelId = "m") =>
  fallbackProviders({ catalog, modelId, chosenProviderId, env, ...(setting !== undefined && { setting }) });

describe("fallbackProviders: запасные провайдеры той же модели", () => {
  // Единственный тест на значение по умолчанию: решение В1 переворачивается одной правкой в next-attempt.ts.
  it("по умолчанию включены: провайдеры модели по порядку профиля, без выбранного и без провайдеров без ключа", () => {
    expect(candidates("a")).toEqual(["b", "c"]);
  });

  it("порядок — из профиля, выбранный пропускается", () => {
    expect(candidates("b", {})).toEqual(["a", "c"]);
    expect(candidates("d", {})).toEqual(["a", "b", "c"]);
  });

  it("byModel задаёт свой порядок; выбранный и провайдеры без ключа выпадают", () => {
    expect(candidates("a", { byModel: { m: ["c", "a", "d", "b"] } })).toEqual(["c", "b"]);
  });

  it("byModel другой модели не меняет порядок этой", () => {
    expect(candidates("a", { byModel: { other: ["b"] } })).toEqual(["b", "c"]);
  });

  it("false выключает совсем, byModel[модель] = false — для одной модели", () => {
    expect(candidates("a", false)).toEqual([]);
    expect(candidates("a", { byModel: { m: false } })).toEqual([]);
    expect(candidates("a", { byModel: { m: false } }, "other")).toEqual(["b"]);
  });
});

describe("decideNextAttempt", () => {
  const failed = (kind: ChatErrorKind, contentSeen = false): Extract<AttemptResult, { outcome: "failed" }> => ({
    outcome: "failed",
    kind,
    error: new Error(kind),
    contentSeen,
  });

  it.each(["overloaded", "rate_limited"] as const)("%s до первого куска, переход не тратился, есть кандидат → fallback", (kind) => {
    expect(decideNextAttempt(failed(kind), { fallbackUsed: false, fallbackProviderIds: ["b", "c"] })).toEqual({
      action: "fallback",
      providerId: "b",
    });
  });

  it("после первого куска ответа — fail (FR-032)", () => {
    expect(decideNextAttempt(failed("overloaded", true), { fallbackUsed: false, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
  });

  it("переход уже был — fail: один переход на ход", () => {
    expect(decideNextAttempt(failed("overloaded"), { fallbackUsed: true, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
  });

  it("кандидатов нет — fail", () => {
    expect(decideNextAttempt(failed("overloaded"), { fallbackUsed: false, fallbackProviderIds: [] })).toEqual({ action: "fail" });
  });

  it.each(["context_overflow", "other"] as const)("вид %s — fail (FR-032)", (kind) => {
    expect(decideNextAttempt(failed(kind), { fallbackUsed: false, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
  });

  describe("деньги кончились или ключ не принят: провайдер не ответит вовсе — сразу следующий", () => {
    it.each(["insufficient_funds", "invalid_key"] as const)("%s → fallback на первого из списка", (kind) => {
      expect(decideNextAttempt(failed(kind), { fallbackUsed: false, fallbackProviderIds: ["b", "c"] })).toEqual({ action: "fallback", providerId: "b" });
    });

    it.each(["insufficient_funds", "invalid_key"] as const)("%s → fallback и после перехода по перегрузке: он не тратит единственный переход", (kind) => {
      expect(decideNextAttempt(failed(kind), { fallbackUsed: true, fallbackProviderIds: ["c"] })).toEqual({ action: "fallback", providerId: "c" });
    });

    it.each(["insufficient_funds", "invalid_key"] as const)("%s посреди ответа (на следующем шаге) → fallback, не автопродолжение у мёртвого", (kind) => {
      const state = { fallbackUsed: false, fallbackProviderIds: ["b"], autoContinue: { done: 0, approvalRequested: false, random: () => 0 } };
      expect(decideNextAttempt(failed(kind, true), state)).toEqual({ action: "fallback", providerId: "b" });
    });

    it.each(["insufficient_funds", "invalid_key"] as const)("%s, запасных нет — fail", (kind) => {
      expect(decideNextAttempt(failed(kind), { fallbackUsed: false, fallbackProviderIds: [] })).toEqual({ action: "fail" });
    });
  });

  describe("403 не по ключу и не по деньгам", () => {
    const refused = (body: string, contentSeen = false): Extract<AttemptResult, { outcome: "failed" }> => ({
      outcome: "failed",
      kind: "other",
      error: new APICallError({ message: "403", url: "https://p.test", requestBodyValues: {}, statusCode: 403, responseBody: body }),
      contentSeen,
    });
    const region = '{"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported"}}';

    it("регион или доступ к модели — запасной, как при перегрузке: другой провайдер может ответить", () => {
      expect(decideNextAttempt(refused(region), { fallbackUsed: false, fallbackProviderIds: ["b"] })).toEqual({ action: "fallback", providerId: "b" });
    });

    it("регион, но переход по перегрузке уже был — fail: такой переход тоже один на ход", () => {
      expect(decideNextAttempt(refused(region), { fallbackUsed: true, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
    });

    it("модерация («input was flagged») — fail: дело в содержимом, другому провайдеру его не передаём", () => {
      const flagged = '{"error":{"message":"Your chosen model requires moderation and your input was flagged for \\"violence\\""}}';
      expect(decideNextAttempt(refused(flagged), { fallbackUsed: false, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
    });
  });

  describe("переполнение (FR-012): сжать и продолжить тот же ответ", () => {
    const state = (history: boolean, answerSteps: boolean) => ({
      fallbackUsed: false,
      fallbackProviderIds: ["b"],
      overflowCompaction: { history, answerSteps },
    });

    it.each([false, true])("сначала — сжатие истории чата, был ли уже ответ или нет (contentSeen=%s)", (contentSeen) => {
      expect(decideNextAttempt(failed("context_overflow", contentSeen), state(true, true))).toEqual({ action: "compact-and-continue", scope: "history" });
    });

    it("история уже сжималась в этом ходе — пересказ первых шагов ответа", () => {
      expect(decideNextAttempt(failed("context_overflow", true), state(false, true))).toEqual({ action: "compact-and-continue", scope: "answer-steps" });
    });

    it("оба способа потрачены или недоступны — fail", () => {
      expect(decideNextAttempt(failed("context_overflow", true), state(false, false))).toEqual({ action: "fail" });
      expect(decideNextAttempt(failed("context_overflow"), { fallbackUsed: false, fallbackProviderIds: ["b"] })).toEqual({ action: "fail" });
    });

    it.each(["rate_limited", "overloaded", "other"] as const)("вид %s — не сжатие (US4 сц. 5)", (kind) => {
      expect(decideNextAttempt(failed(kind, true), state(true, true))).toEqual({ action: "fail" });
    });
  });

  describe("автопродолжение (FR-037, FR-038, FR-042, FR-044): обрыв посреди ответа", () => {
    const state = (done: number, extra: { approvalRequested?: boolean; random?: () => number } = {}) => ({
      fallbackUsed: false,
      fallbackProviderIds: ["b"],
      overflowCompaction: { history: true, answerSteps: true },
      autoContinue: { done, approvalRequested: extra.approvalRequested ?? false, random: extra.random ?? (() => 0) },
    });

    it.each(["overloaded", "rate_limited"] as const)("%s после содержательного куска → auto-continue с паузой 2 с, не запасной", (kind) => {
      expect(decideNextAttempt(failed(kind, true), state(0))).toEqual({ action: "auto-continue", pauseMs: 2_000 });
    });

    it("второе — пауза 5 с плюс разброс; случайность подменяется", () => {
      expect(decideNextAttempt(failed("overloaded", true), state(1, { random: () => 0.4 }))).toEqual({ action: "auto-continue", pauseMs: 5_500 });
    });

    it("два уже было — fail: не больше двух на ход", () => {
      expect(decideNextAttempt(failed("overloaded", true), state(2))).toEqual({ action: "fail" });
    });

    it("в ответе запрос подтверждения — fail", () => {
      expect(decideNextAttempt(failed("overloaded", true), state(0, { approvalRequested: true }))).toEqual({ action: "fail" });
    });

    it("вид other — fail", () => {
      expect(decideNextAttempt(failed("other", true), state(0))).toEqual({ action: "fail" });
    });

    it("context_overflow — путь сжатия, не автопродолжение", () => {
      expect(decideNextAttempt(failed("context_overflow", true), state(0))).toEqual({ action: "compact-and-continue", scope: "history" });
    });

    it("до первого куска — прежний путь запасного, а не автопродолжение", () => {
      expect(decideNextAttempt(failed("overloaded", false), state(0))).toEqual({ action: "fallback", providerId: "b" });
    });

    it("после содержательного куска запасной не выбирается, даже когда автопродолжения кончились (FR-042)", () => {
      for (const done of [0, 1, 2]) {
        expect(decideNextAttempt(failed("overloaded", true), state(done)).action).not.toBe("fallback");
      }
    });
  });
});

describe("переход посреди ответа при молчании модели (onSilence: restart-step-on-next)", () => {
  const silence = (contentSeen: boolean, error: Error = contentSeen ? new StreamStallError(120_000) : new FirstChunkTimeoutError(90_000)) =>
    ({ outcome: "failed", kind: "overloaded", error, contentSeen }) as const;
  const state = (silenceSwitch: { done: number; max: number; nextProviderId?: string }, approvalRequested = false) => ({
    fallbackUsed: false,
    fallbackProviderIds: ["b", "c"],
    autoContinue: { done: 0, approvalRequested, random: () => 0 },
    silenceSwitch,
  });

  it.each([false, true])("молчание (было ли содержимое: %s) → restart-step у следующего провайдера", (contentSeen) => {
    expect(decideNextAttempt(silence(contentSeen), state({ done: 0, max: 1, nextProviderId: "b" }))).toEqual({ action: "restart-step", providerId: "b" });
  });

  it("переходы кончились — прежний путь: до содержимого запасной, после — автопродолжение", () => {
    expect(decideNextAttempt(silence(false), state({ done: 1, max: 1, nextProviderId: "c" }))).toEqual({ action: "fallback", providerId: "b" });
    expect(decideNextAttempt(silence(true), state({ done: 1, max: 1, nextProviderId: "c" }))).toEqual({ action: "auto-continue", pauseMs: 2_000 });
  });

  it("следующего провайдера нет — прежний путь", () => {
    expect(decideNextAttempt(silence(true), state({ done: 0, max: 2 }))).toEqual({ action: "auto-continue", pauseMs: 2_000 });
  });

  it("перегрузка без молчания — прежний путь, не переход посреди ответа", () => {
    const overloaded = { outcome: "failed", kind: "overloaded", error: new Error("503"), contentSeen: true } as const;
    expect(decideNextAttempt(overloaded, state({ done: 0, max: 1, nextProviderId: "b" }))).toEqual({ action: "auto-continue", pauseMs: 2_000 });
  });

  it("в ответе запрос подтверждения — прежний путь (fail)", () => {
    expect(decideNextAttempt(silence(true), state({ done: 0, max: 1, nextProviderId: "b" }, true))).toEqual({ action: "fail" });
  });

  it("без настройки — прежнее поведение", () => {
    expect(decideNextAttempt(silence(true), { fallbackUsed: false, fallbackProviderIds: ["b"], autoContinue: { done: 0, approvalRequested: false, random: () => 0 } })).toEqual({
      action: "auto-continue",
      pauseMs: 2_000,
    });
  });

  it("resolveSilenceSwitch: по умолчанию continue, turn, один переход; заданное — как есть", () => {
    const defaults = { onSilence: "continue", scope: "turn", maxSwitches: 1 };
    expect(resolveSilenceSwitch(undefined)).toEqual(defaults);
    expect(resolveSilenceSwitch(false)).toEqual(defaults);
    expect(resolveSilenceSwitch({})).toEqual(defaults);
    expect(resolveSilenceSwitch({ onSilence: "restart-step-on-next", scope: "step", maxSwitches: 3 })).toEqual({
      onSilence: "restart-step-on-next",
      scope: "step",
      maxSwitches: 3,
    });
  });

  it("nextSilenceProvider: с основного — первый запасной; с запасного — следующий за ним; с последнего — нет", () => {
    const fallbackProviderIds = ["b", "c"];
    expect(nextSilenceProvider({ currentProviderId: "a", primaryProviderId: "a", fallbackProviderIds })).toBe("b");
    expect(nextSilenceProvider({ currentProviderId: "b", primaryProviderId: "a", fallbackProviderIds })).toBe("c");
    expect(nextSilenceProvider({ currentProviderId: "c", primaryProviderId: "a", fallbackProviderIds })).toBeUndefined();
    expect(nextSilenceProvider({ currentProviderId: "a", primaryProviderId: "a", fallbackProviderIds: [] })).toBeUndefined();
  });
});

describe("checkProviderFallback: проверка настройки при создании службы", () => {
  it.each<ProviderFallbackSetting | undefined>([undefined, false, {}, { byModel: {} }, { byModel: { m: ["c", "b"] } }, { byModel: { m: false } }])("верная настройка %j — без ошибки", (setting) => {
    expect(() => checkProviderFallback(setting, catalog)).not.toThrow();
  });

  it("провайдер, которого нет у модели, — ошибка с именами модели и провайдера", () => {
    expect(() => checkProviderFallback({ byModel: { other: ["a", "c"] } }, catalog)).toThrow(TypeError);
    expect(() => checkProviderFallback({ byModel: { other: ["a", "c"] } }, catalog)).toThrow(/other.*«c»|«c».*other/);
  });

  it.each<ProviderFallbackSetting>([
    { onSilence: "continue" },
    { onSilence: "restart-step-on-next", scope: "step", maxSwitches: 2 },
    { onSilence: "restart-step-on-next", scope: "turn", maxSwitches: 0, byModel: { m: ["c"] } },
  ])("переход при молчании %j — без ошибки", (setting) => {
    expect(() => checkProviderFallback(setting, catalog)).not.toThrow();
  });

  it.each([
    [{ onSilence: "restart" }, /onSilence/],
    [{ scope: "chat" }, /scope/],
    [{ maxSwitches: -1 }, /maxSwitches/],
    [{ maxSwitches: 1.5 }, /maxSwitches/],
    [{ maxSwitches: "2" }, /maxSwitches/],
  ])("неверное %j — TypeError с именем поля", (setting, field) => {
    expect(() => checkProviderFallback(setting as never, catalog)).toThrow(TypeError);
    expect(() => checkProviderFallback(setting as never, catalog)).toThrow(field);
  });

  it("модели нет в каталоге — ошибка с её именем", () => {
    expect(() => checkProviderFallback({ byModel: { nope: ["a"] } }, catalog)).toThrow(/nope/);
  });

  it.each([true, "a", { byModel: { m: "a" } }, { byModel: [] }])("неверная форма %j — TypeError", (setting) => {
    expect(() => checkProviderFallback(setting as never, catalog)).toThrow(TypeError);
  });
});

describe("errorKindForPerson: что показать человеку, когда не ответил никто", () => {
  it("отказов по деньгам и ключу в ходе не было — вид последнего сбоя", () => {
    expect(errorKindForPerson("overloaded", undefined)).toBe("overloaded");
    expect(errorKindForPerson("other", undefined)).toBe("other");
  });

  it.each(["insufficient_funds", "invalid_key", "other"] as const)("основной отказал по деньгам, запасной — %s: исходная причина у основного", (last) => {
    expect(errorKindForPerson(last, "insufficient_funds")).toBe("insufficient_funds");
  });

  it.each(["overloaded", "rate_limited", "context_overflow"] as const)("запасной лишь занят или запрос велик (%s) — его вид: «попробуйте позже» поможет", (last) => {
    expect(errorKindForPerson(last, "insufficient_funds")).toBe(last);
  });
});
