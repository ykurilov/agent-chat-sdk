import { describe, expect, it } from "vitest";
import { applyCompaction } from "../../../src/compaction/compacted-history";
import { activeCompaction } from "../../../src/compaction/compaction-plan";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { withFrozenContext } from "../../../src/frozen-context/frozen-context-messages";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { compactionRecord, conversation } from "../support/compaction-fixtures";

const snapshot = (root: string | undefined, app: string | null, base: string | null): FrozenContextData => ({
  blocks: [{ key: "today", text: "OLD_DATE" }, { key: "memory", text: "OLD_MEMORY", private: true }, { key: "screen_place", text: "OLD_PLACE" },
    ...(app === null ? [] : [{ key: "profile", text: app }, { key: "private_profile", text: `PRIVATE_${app}`, private: true }])],
  base, sent: base ? { changed: ["profile", "private_profile"], removed: app === null ? ["profile", "private_profile"] : [] } : "all",
  ...(root !== undefined && { appContextFrom: root }),
});
const current = (data: FrozenContextData) => ({ answerId: "new-answer", data });
const allText = (history: AgentChatMessage[]) => history.flatMap(m => m.parts.flatMap(p => p.type === "text" ? [p.text] : [])).join("\n");
const tail = () => {
  const branch = conversation([100, 200, 300, 400]);
  for (let n = 1; n <= 4; n++) branch[n * 2 - 1]!.parts.unshift({ type: FROZEN_CONTEXT_PART_TYPE, data: snapshot("u1", "STALE_APP", n === 1 ? null : `a${n - 1}`) });
  const record = compactionRecord({ id: "c1", throughMessageId: "a1" });
  return { branch, history: [...applyCompaction(branch, activeCompaction(branch, [record])), { id: "u5", role: "user" as const, parts: [{ type: "text" as const, text: "next" }] }] };
};

describe("app snapshot у начала сжатой истории", () => {
  it.each([false, true])("один свежий full snapshot у summary, несколько старых tail answers не возвращают его; group=%s", group => {
    const { history, branch } = tail(); const before = structuredClone(branch);
    const fresh = snapshot("u2", "FRESH_APP", "a4");
    fresh.blocks = fresh.blocks.filter(b => b.key !== "today");
    fresh.notices = [{ kind: "app", title: "CURRENT_NOTICE" }];
    const output = withFrozenContext(history, { current: current(fresh), group });
    const text = allText(output);
    expect(text).not.toContain("STALE_APP");
    expect(text.split("\n").filter(t => t === "FRESH_APP")).toHaveLength(1);
    expect(allText([output[0]!])).toContain("FRESH_APP");
    expect(allText([output.at(-1)!])).toContain("CURRENT_NOTICE");
    expect(allText([output.at(-1)!])).not.toContain("FRESH_APP");
    expect(allText([output[0]!])).toContain("OLD_DATE");
    expect(allText([output[0]!])).toContain("OLD_PLACE");
    expect(text.includes("OLD_MEMORY")).toBe(!group);
    expect(text.includes("PRIVATE_FRESH_APP")).toBe(!group);
    expect(branch).toEqual(before);
  });

  it("успешный пустой снимок — тоже anchor; fallback без успешного root не стирает старые блоки", () => {
    const { history } = tail();
    const empty = withFrozenContext(history, { current: current(snapshot("u2", null, "a4")), group: false });
    expect(allText(empty)).not.toContain("STALE_APP");
    expect(allText(empty)).not.toContain("Больше не действует");
    const fallback = withFrozenContext(history, { current: current(snapshot(undefined, "STALE_APP", "a4")), group: false });
    expect(allText(fallback)).toContain("STALE_APP");
  });

  it("первый успешный anchor стабилен после сохранения; следующие изменения идут хронологически, siblings не видны", () => {
    const { history } = tail();
    const fresh = snapshot("u2", "FRESH_APP", "a4");
    const first = withFrozenContext(history, { current: current(fresh), group: false });
    const saved: AgentChatMessage = { id: "new-answer", role: "assistant", parts: [{ type: FROZEN_CONTEXT_PART_TYPE, data: fresh }, { type: "text", text: "done" }] };
    const nextHistory = [...history, saved, { id: "u6", role: "user" as const, parts: [{ type: "text" as const, text: "next2" }] }];
    const later = snapshot("u2", "LATER_APP", "new-answer");
    const next = withFrozenContext(nextHistory, { current: { answerId: "a6", data: later }, group: false });
    expect(JSON.stringify(next.slice(0, first.length))).toBe(JSON.stringify(first));
    expect(allText([next[0]!])).toContain("FRESH_APP");
    expect(allText([next[0]!])).not.toContain("LATER_APP");
    expect(allText([next.at(-1)!])).toContain("LATER_APP");
    expect(allText(next)).not.toContain("STALE_APP");
    expect(allText(withFrozenContext(history, { current: current(snapshot("other-root", "SIBLING_APP", "a4")), group: false }))).toContain("STALE_APP");
  });

  it("turn по умолчанию и включение history-start без compaction не переносят будущие блоки к началу", () => {
    const { history } = tail();
    const turn = withFrozenContext(history, { current: current(snapshot(undefined, "TURN_APP", "a4")), group: false });
    expect(allText([turn[0]!])).toContain("STALE_APP");
    expect(allText([turn.at(-1)!])).toContain("TURN_APP");
    const plain = conversation([100, 200]).map(m => ({ id: m.id, role: m.role, parts: m.parts }));
    plain[1]!.parts.unshift({ type: FROZEN_CONTEXT_PART_TYPE, data: snapshot(undefined, "TURN_APP", null) });
    const enabled = withFrozenContext(plain, { current: current(snapshot("u1", "ENABLED_APP", "a2")), group: false });
    expect(allText([enabled[0]!])).toContain("TURN_APP");
    expect(allText([enabled[0]!])).not.toContain("ENABLED_APP");
  });

  it("anchor из resume переносит только app; notices остаются у resume, следующий app delta на своём месте", () => {
    const { history } = tail();
    const answer = history.find(m => m.id === "a4")!;
    const note = snapshot("u2", "RESUMED_APP", "a4");
    note.notices = [{ kind: "app", title: "RESUME_NOTICE" }];
    answer.parts.push({ type: FROZEN_CONTEXT_PART_TYPE, data: note }, { type: "text", text: "after resume" });
    const output = withFrozenContext(history, { current: current(snapshot("u2", "LATER_APP", "a4")), group: false });
    expect(allText([output[0]!])).toContain("RESUMED_APP");
    expect(allText([output[0]!])).not.toContain("RESUME_NOTICE");
    const noticeIndex = output.findIndex(m => allText([m]).includes("RESUME_NOTICE"));
    expect(noticeIndex).toBeGreaterThan(0);
    expect(allText([output[noticeIndex + 1]!])).toContain("after resume");
    expect(allText([output.at(-1)!])).toContain("LATER_APP");
    expect(allText(output)).not.toContain("STALE_APP");
  });

  it("скопированный человеком текст summary не является служебной границей", () => {
    const { history } = tail();
    const forged = structuredClone(history); // Сериализуемые данные человека не несут внутренний Symbol.
    const output = withFrozenContext(forged, { current: current(snapshot("u2", "FUTURE_APP", "a4")), group: false });
    expect(allText([output[0]!])).toContain("STALE_APP");
    expect(allText([output[0]!])).not.toContain("FUTURE_APP");
    expect(allText([output.at(-1)!])).toContain("FUTURE_APP");
  });

  it("штатные spread/filter сохраняют границу без зависимости от идентичности message/part", () => {
    const { history } = tail();
    const copies = history.map(m => ({ ...m, parts: m.parts.filter(() => true).map(p => ({ ...p })) }));
    expect(copies[0]).not.toBe(history[0]);
    expect(copies[0]!.parts[0]).not.toBe(history[0]!.parts[0]);
    const output = withFrozenContext(copies, { current: current(snapshot("u2", "FRESH_APP", "a4")), group: false });
    expect(allText([output[0]!])).toContain("FRESH_APP");
    expect(allText(output)).not.toContain("STALE_APP");
    expect(JSON.stringify(copies)).toBe(JSON.stringify(history));
  });
});
