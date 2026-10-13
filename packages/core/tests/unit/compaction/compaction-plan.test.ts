import { describe, expect, it } from "vitest";
import {
  activeCompaction,
  contextSizeOf,
  isCompactionDue,
  planCompaction,
} from "../../../src/compaction/compaction-plan";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { compactionRecord, conversation, timeAt } from "../support/compaction-fixtures";

const settings = resolveCompactionSettings({ thresholdTokens: 1000, tailTokens: 300, summaryCeilingTokens: 100 })!;

describe("размер контекста ответа", () => {
  it("берётся contextTokens; у старых сообщений — вход плюс выход; без числа — неизвестен", () => {
    const [, withContext] = conversation([500]);
    expect(contextSizeOf(withContext!)).toBe(500);
    const legacy = {
      ...withContext!,
      usage: { inputTokens: 700, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 },
    };
    expect(contextSizeOf(legacy)).toBe(750);
    expect(contextSizeOf({ ...withContext!, usage: null })).toBeNull();
    expect(contextSizeOf({ ...withContext!, usage: { ...legacy.usage, inputTokens: 0, outputTokens: 0 } })).toBeNull();
  });
});

describe("активная запись сжатия", () => {
  const branch = conversation([100, 200, 300, 400]);

  it("нет записей — нет активной", () => {
    expect(activeCompaction(branch, [])).toBeNull();
  });

  it("активна последняя запись, чьё последнее сообщение лежит на ветке и после которого что-то есть", () => {
    const early = compactionRecord({ id: "c1", throughMessageId: "a1" });
    const late = compactionRecord({ id: "c2", throughMessageId: "a2" });
    expect(activeCompaction(branch, [early, late])).toMatchObject({ record: { id: "c2" }, throughIndex: 3 });
    expect(activeCompaction(branch, [late, early])).toMatchObject({ record: { id: "c1" }, throughIndex: 1 });
  });

  it("запись с границей вне ветки или на самом конце ветки не применяется", () => {
    const elsewhere = compactionRecord({ id: "c1", throughMessageId: "other-branch" });
    const atEnd = compactionRecord({ id: "c2", throughMessageId: "a4" });
    expect(activeCompaction(branch, [elsewhere, atEnd])).toBeNull();
    const useful = compactionRecord({ id: "c0", throughMessageId: "a1" });
    expect(activeCompaction(branch, [useful, elsewhere, atEnd])).toMatchObject({ record: { id: "c0" } });
  });
});

describe("пора ли сжимать после ответа", () => {
  const due = (contexts: Array<number | null>, records = [] as ReturnType<typeof compactionRecord>[], window = 10_000) =>
    isCompactionDue({ branch: conversation(contexts), compactions: records, contextWindowTokens: window, settings });

  it("контекст выше порога — пора, не выше — нет", () => {
    expect(due([500, 1001])).toBe(true);
    expect(due([500, 1000])).toBe(false);
  });

  it("порог не больше 80% окна", () => {
    expect(due([500, 801], [], 1000)).toBe(true);
    expect(due([500, 799], [], 1000)).toBe(false);
  });

  it("число от провайдера неизвестно — не сжимаем вслепую", () => {
    expect(due([500, null])).toBe(false);
  });

  it("последний ответ не завершён штатно — не пора", () => {
    const branch = conversation([500, 2000]);
    branch[3] = { ...branch[3]!, status: "stopped" };
    expect(isCompactionDue({ branch, compactions: [], contextWindowTokens: 10_000, settings })).toBe(false);
  });

  it("ответ дан на полном контексте (создан раньше активной записи) — по его числу повторно не сжимаем", () => {
    const laterThanAnswer = compactionRecord({ id: "c1", throughMessageId: "a1", createdAt: timeAt(100) });
    expect(due([500, 2000], [laterThanAnswer])).toBe(false);
    const earlierThanAnswer = compactionRecord({ id: "c2", throughMessageId: "a1", createdAt: timeAt(2) });
    expect(due([500, 2000], [earlierThanAnswer])).toBe(true);
  });
});

describe("план сжатия: где проходит граница", () => {
  const plan = (contexts: Array<number | null>, records = [] as ReturnType<typeof compactionRecord>[], tailTokens = 300) =>
    planCompaction({ branch: conversation(contexts), compactions: records, tailTokens });

  it("граница — самый поздний ответ, после которого набралось не меньше хвоста; хвост начинается с вопроса", () => {
    // контекст после ответов: 200, 400, 700, 1000, 1100; хвост ≥ 300 → кандидат a4? 1100−1000=100 нет; a3: 1100−700=400 да
    expect(plan([200, 400, 700, 1000, 1100])).toEqual({ fromMessageId: "u1", throughMessageId: "a3", throughIndex: 5 });
  });

  it("точное совпадение с хвостом подходит", () => {
    expect(plan([200, 400, 700, 1000])).toMatchObject({ throughMessageId: "a3" }); // 1000−700 = 300
  });

  it("все ответы свежее хвоста — сжимать нечего", () => {
    expect(plan([100, 200, 300])).toBeNull(); // 300−100 = 200 < 300
    expect(plan([1000])).toBeNull();
  });

  it("ответ без числа не бывает границей; последнему числу нужно быть", () => {
    expect(plan([200, null, 700, 1000])).toMatchObject({ throughMessageId: "a3" });
    expect(plan([200, 400, 700, null])).toBeNull();
    expect(plan([null, null, 900, 1500])).toMatchObject({ throughMessageId: "a3" });
  });

  it("незавершённый и не штатный ответ не бывает границей", () => {
    const branch = conversation([200, 400, 700, 1000]);
    branch[5] = { ...branch[5]!, status: "error" }; // a3
    expect(planCompaction({ branch, compactions: [], tailTokens: 300 })).toMatchObject({ throughMessageId: "a2" });
  });

  it("при активной записи диапазон новой начинается с начала прежней, а границей бывают только ответы после неё", () => {
    const record = compactionRecord({ id: "c1", fromMessageId: "u1", throughMessageId: "a1", createdAt: timeAt(2) });
    // a2 (секунда 3) и позже созданы после записи; числа отсчитываются от сводки: 300, 500, 900
    const result = plan([9000, 300, 500, 900], [record]);
    expect(result).toEqual({ fromMessageId: "u1", throughMessageId: "a3", throughIndex: 5 }); // 900−500=400 ≥ 300; a3 позже a2
  });

  it("ответ, созданный раньше активной записи, границей не бывает", () => {
    const record = compactionRecord({ id: "c1", throughMessageId: "a1", createdAt: timeAt(4) }); // после a2 (секунда 3)
    expect(plan([9000, 100, 500, 900], [record])).toMatchObject({ throughMessageId: "a3" }); // a2 не подходит, a3: 900−500=400
    expect(plan([9000, 100, 200, 300], [record])).toBeNull();
  });

  it("вопрос без ответа в хвосте не мешает: хвост идёт до конца ветки", () => {
    const branch = [...conversation([200, 700, 1000]), ...conversation([0], "chat-1").slice(0, 1).map((m) => ({ ...m, id: "u4", parentId: "a3", createdAt: timeAt(99) }))];
    expect(planCompaction({ branch, compactions: [], tailTokens: 300 })).toMatchObject({ throughMessageId: "a2" });
  });
});
