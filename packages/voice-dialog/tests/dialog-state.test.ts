import { describe, expect, it, vi } from "vitest";
import { createDialogState } from "../src/browser/dialog-state";
import type { DialogEvent } from "../src/browser/dialog-state";
import type { VoiceDialogState } from "@ykurilov/agent-chat-react";

function driven(...events: DialogEvent[]) {
  const dialog = createDialogState();
  for (const event of events) dialog.dispatch(event);
  return dialog;
}

const OPEN: DialogEvent[] = [{ type: "open" }, { type: "connected" }];

describe("состояния режима: обычный ход разговора", () => {
  it("начинает с «выключено»", () => {
    expect(createDialogState().current()).toEqual({ state: "off" });
  });

  it("off → connecting → listening → thinking → speaking → listening", () => {
    const dialog = createDialogState();
    const seen: VoiceDialogState[] = [];
    for (const event of [
      { type: "open" },
      { type: "connected" },
      { type: "phrase_sent" },
      { type: "speech_started" },
      { type: "reply_finished" },
    ] as const) {
      expect(dialog.dispatch(event)).toBe(true);
      seen.push(dialog.current().state);
    }
    expect(seen).toEqual(["connecting", "listening", "thinking", "speaking", "listening"]);
  });

  it("ответ без звука (озвучка недоступна или нечего говорить): thinking → listening", () => {
    expect(driven(...OPEN, { type: "phrase_sent" }, { type: "reply_finished" }).current().state).toBe("listening");
  });
});

describe("состояния режима: перебивание", () => {
  it("speaking → interrupted → listening", () => {
    const dialog = driven(...OPEN, { type: "phrase_sent" }, { type: "speech_started" });
    expect(dialog.dispatch({ type: "interrupted" })).toBe(true);
    expect(dialog.current().state).toBe("interrupted");
    expect(dialog.dispatch({ type: "listening_again" })).toBe(true);
    expect(dialog.current().state).toBe("listening");
  });

  it("перебить можно и пока агент думает (звука ещё нет)", () => {
    const dialog = driven(...OPEN, { type: "phrase_sent" });
    expect(dialog.dispatch({ type: "interrupted" })).toBe(true);
    expect(dialog.current().state).toBe("interrupted");
  });

  it("сказанное успело закончиться, пока идёт «перебито»: interrupted → thinking", () => {
    const dialog = driven(...OPEN, { type: "phrase_sent" }, { type: "interrupted" });
    expect(dialog.dispatch({ type: "phrase_sent" })).toBe(true);
    expect(dialog.current().state).toBe("thinking");
  });

  it("два перебивания подряд: во второй раз состояние то же, без ошибки", () => {
    const dialog = driven(...OPEN, { type: "phrase_sent" }, { type: "speech_started" }, { type: "interrupted" });
    expect(dialog.dispatch({ type: "interrupted" })).toBe(false);
    expect(dialog.current().state).toBe("interrupted");
  });
});

describe("состояния режима: ошибка и выход", () => {
  it.each<[string, DialogEvent[]]>([
    ["connecting", [{ type: "open" }]],
    ["listening", [...OPEN]],
    ["thinking", [...OPEN, { type: "phrase_sent" }]],
    ["speaking", [...OPEN, { type: "phrase_sent" }, { type: "speech_started" }]],
    ["interrupted", [...OPEN, { type: "phrase_sent" }, { type: "interrupted" }]],
  ])("из «%s» — в ошибку с видом ошибки", (_from, prefix) => {
    const dialog = driven(...prefix);
    expect(dialog.dispatch({ type: "failed", error: "network" })).toBe(true);
    expect(dialog.current()).toEqual({ state: "error", error: "network" });
  });

  it.each<[string, DialogEvent[]]>([
    ["connecting", [{ type: "open" }]],
    ["listening", [...OPEN]],
    ["thinking", [...OPEN, { type: "phrase_sent" }]],
    ["speaking", [...OPEN, { type: "phrase_sent" }, { type: "speech_started" }]],
    ["interrupted", [...OPEN, { type: "phrase_sent" }, { type: "interrupted" }]],
    ["error", [...OPEN, { type: "failed", error: "limit" }]],
  ])("из «%s» можно выйти", (_from, prefix) => {
    const dialog = driven(...prefix);
    expect(dialog.dispatch({ type: "close" })).toBe(true);
    expect(dialog.current()).toEqual({ state: "off" });
  });

  it("ошибка забывается при выходе и при повторном включении", () => {
    const dialog = driven({ type: "open" }, { type: "failed", error: "microphone_denied" });
    expect(dialog.dispatch({ type: "open" })).toBe(true);
    expect(dialog.current()).toEqual({ state: "connecting" });
  });

  it("выход из выключенного режима — не переход", () => {
    expect(createDialogState().dispatch({ type: "close" })).toBe(false);
  });

  it("ошибка в выключенном режиме — не переход", () => {
    const dialog = createDialogState();
    expect(dialog.dispatch({ type: "failed", error: "network" })).toBe(false);
    expect(dialog.current().state).toBe("off");
  });
});

describe("состояния режима: запрещённые переходы", () => {
  it.each<[from: string, prefix: DialogEvent[], event: DialogEvent]>([
    ["off", [], { type: "connected" }],
    ["off", [], { type: "phrase_sent" }],
    ["off", [], { type: "speech_started" }],
    ["off", [], { type: "interrupted" }],
    ["connecting", [{ type: "open" }], { type: "phrase_sent" }],
    ["connecting", [{ type: "open" }], { type: "speech_started" }],
    ["connecting", [{ type: "open" }], { type: "interrupted" }],
    ["connecting", [{ type: "open" }], { type: "open" }],
    ["listening", [...OPEN], { type: "speech_started" }],
    ["listening", [...OPEN], { type: "interrupted" }],
    ["listening", [...OPEN], { type: "reply_finished" }],
    ["listening", [...OPEN], { type: "open" }],
    ["thinking", [...OPEN, { type: "phrase_sent" }], { type: "phrase_sent" }],
    ["thinking", [...OPEN, { type: "phrase_sent" }], { type: "connected" }],
    ["speaking", [...OPEN, { type: "phrase_sent" }, { type: "speech_started" }], { type: "phrase_sent" }],
    ["speaking", [...OPEN, { type: "phrase_sent" }, { type: "speech_started" }], { type: "speech_started" }],
    ["speaking", [...OPEN, { type: "phrase_sent" }, { type: "speech_started" }], { type: "listening_again" }],
    ["interrupted", [...OPEN, { type: "phrase_sent" }, { type: "interrupted" }], { type: "speech_started" }],
    ["interrupted", [...OPEN, { type: "phrase_sent" }, { type: "interrupted" }], { type: "reply_finished" }],
    ["error", [...OPEN, { type: "failed", error: "network" }], { type: "connected" }],
    ["error", [...OPEN, { type: "failed", error: "network" }], { type: "phrase_sent" }],
    ["error", [...OPEN, { type: "failed", error: "network" }], { type: "failed", error: "limit" }],
  ])("из «%s» событие %j не меняет состояние", (from, prefix, event) => {
    const dialog = driven(...prefix);
    const before = dialog.current();
    expect(dialog.dispatch(event)).toBe(false);
    expect(dialog.current()).toEqual(before);
    expect(before.state).toBe(from);
  });
});

describe("состояния режима: подписка", () => {
  it("слушатель получает каждое изменение; запрещённый переход его не зовёт", () => {
    const dialog = createDialogState();
    const listener = vi.fn();
    dialog.subscribe(listener);
    dialog.dispatch({ type: "open" });
    dialog.dispatch({ type: "phrase_sent" });
    dialog.dispatch({ type: "connected" });
    expect(listener.mock.calls.map(([snapshot]) => snapshot)).toEqual([{ state: "connecting" }, { state: "listening" }]);
  });

  it("отписка работает", () => {
    const dialog = createDialogState();
    const listener = vi.fn();
    const unsubscribe = dialog.subscribe(listener);
    unsubscribe();
    dialog.dispatch({ type: "open" });
    expect(listener).not.toHaveBeenCalled();
  });
});
