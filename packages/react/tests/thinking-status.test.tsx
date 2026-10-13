// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLabelsProvider, russianLabels, useThinkingStatus } from "../src/index";
import type { ChatLabels } from "../src/index";
import { nextThinkingPhraseIndex, THINKING_PHRASE_MS, ThinkingClockProvider, ThinkingClocksProvider } from "../src/thinking-status/thinking-status";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-06T10:00:00.000Z") });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const withLabels = (labels: ChatLabels) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ChatLabelsProvider labels={labels}>{children}</ChatLabelsProvider>;
  };

/** Подряд идущие фразы за `seconds` секунд ожидания. */
function phrasesOver(result: { current: { phrase: string } }, seconds: number): string[] {
  const seen = [result.current.phrase];
  for (let second = 0; second < seconds; second++) {
    act(() => void vi.advanceTimersByTime(1_000));
    if (seen.at(-1) !== result.current.phrase) seen.push(result.current.phrase);
  }
  return seen;
}

describe("живая надпись «думает»: фразы", () => {
  it("набор по умолчанию — 8–12 русских фраз; первая — первая из набора", () => {
    expect(russianLabels.thinkingPhrases.length).toBeGreaterThanOrEqual(8);
    expect(russianLabels.thinkingPhrases.length).toBeLessThanOrEqual(12);
    const { result } = renderHook(() => useThinkingStatus());
    expect(result.current.phrase).toBe(russianLabels.thinkingPhrases[0]);
  });

  it("следующая фраза никогда не равна предыдущей, при любом случайном числе", () => {
    for (const random of [0, 0.3, 0.5, 0.999999]) {
      for (let previous = 0; previous < 10; previous++) {
        const next = nextThinkingPhraseIndex(10, previous, () => random);
        expect(next).not.toBe(previous);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(10);
      }
    }
    expect(nextThinkingPhraseIndex(1, 0, () => 0.7)).toBe(0);
  });

  it("фраза сменяется каждые 3–4 секунды и не повторяется дважды подряд", () => {
    const { result } = renderHook(() => useThinkingStatus());
    const changes: number[] = [];
    let previous = result.current.phrase;
    for (let second = 1; second <= 60; second++) {
      act(() => void vi.advanceTimersByTime(1_000));
      if (result.current.phrase !== previous) {
        changes.push(second);
        previous = result.current.phrase;
      }
    }
    expect(THINKING_PHRASE_MS).toBeGreaterThanOrEqual(3_000);
    expect(THINKING_PHRASE_MS).toBeLessThanOrEqual(4_000);
    expect(changes.length).toBeGreaterThanOrEqual(14);
    for (const [index, second] of changes.entries()) {
      const gap = second - (changes[index - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(4);
    }
  });

  it("свой набор приложения через labels.thinkingPhrases", () => {
    const own = ["Собираю экран…", "Подключаю базу…", "Проверяю сборку…"];
    const { result } = renderHook(() => useThinkingStatus(), { wrapper: withLabels({ ...russianLabels, thinkingPhrases: own }) });
    const seen = phrasesOver(result, 40);
    expect(seen.length).toBeGreaterThan(5);
    for (const phrase of seen) expect(own).toContain(phrase);
    for (let index = 1; index < seen.length; index++) expect(seen[index]).not.toBe(seen[index - 1]);
  });

  it("пустой набор — одна фраза reasoningRunning, таймер идёт", () => {
    const { result } = renderHook(() => useThinkingStatus(), { wrapper: withLabels({ ...russianLabels, thinkingPhrases: [] }) });
    expect(phrasesOver(result, 20)).toEqual([russianLabels.reasoningRunning]);
    expect(result.current.elapsed).toBe("20 с");
  });

  it("словарь на другом языке без своих фраз и записи времени — одна его фраза reasoningRunning и время без русских слов", () => {
    const { thinkingPhrases: _phrases, thinkingElapsed: _elapsed, ...english } = { ...russianLabels, reasoningRunning: "Thinking…" };
    const { result } = renderHook(() => useThinkingStatus(), { wrapper: withLabels(english) });
    expect(phrasesOver(result, 12)).toEqual(["Thinking…"]);
    expect(result.current.elapsed).toBe("0:12");
    act(() => void vi.advanceTimersByTime(53_000));
    expect(result.current.elapsed).toBe("1:05");
  });
});

describe("живая надпись «думает»: таймер", () => {
  it("секунды с начала ожидания; после минуты — «1 мин 5 с»", () => {
    const { result } = renderHook(() => useThinkingStatus());
    expect(result.current).toMatchObject({ seconds: 0, elapsed: "0 с" });
    act(() => void vi.advanceTimersByTime(12_000));
    expect(result.current).toMatchObject({ seconds: 12, elapsed: "12 с" });
    act(() => void vi.advanceTimersByTime(48_000));
    expect(result.current.elapsed).toBe("1 мин");
    act(() => void vi.advanceTimersByTime(5_000));
    expect(result.current.elapsed).toBe("1 мин 5 с");
  });

  it("своя запись времени через labels.thinkingElapsed", () => {
    const { result } = renderHook(() => useThinkingStatus(), { wrapper: withLabels({ ...russianLabels, thinkingElapsed: (seconds) => `${seconds}s` }) });
    act(() => void vi.advanceTimersByTime(3_000));
    expect(result.current.elapsed).toBe("3s");
  });

  it("неактивная надпись не держит таймер", () => {
    renderHook(() => useThinkingStatus(false));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("строка ожидания и блок рассуждений одного ответа идут по одним часам: время и фраза не сбрасываются", () => {
    function Line({ name }: { name: string }) {
      const { phrase, elapsed } = useThinkingStatus();
      return <p data-testid={name}>{`${phrase} ${elapsed}`}</p>;
    }
    const { rerender } = render(
      <ThinkingClockProvider>
        <Line name="first" />
      </ThinkingClockProvider>,
    );
    act(() => void vi.advanceTimersByTime(9_000));
    const before = screen.getByTestId("first").textContent;
    rerender(
      <ThinkingClockProvider>
        <Line name="second" />
      </ThinkingClockProvider>,
    );
    expect(screen.getByTestId("second").textContent).toBe(before);
    expect(before).toMatch(/ 9 с$/);
  });

  it("ответ ушёл из вида и вернулся (лента выгрузила его и смонтировала заново) — счёт и фразы продолжаются", () => {
    function Line() {
      const { phrase, elapsed } = useThinkingStatus();
      return <p data-testid="line">{`${phrase} ${elapsed}`}</p>;
    }
    function Answer({ id }: { id: string }) {
      return (
        <ThinkingClockProvider id={id} waiting>
          <Line />
        </ThinkingClockProvider>
      );
    }
    const { rerender } = render(
      <ThinkingClocksProvider>
        <Answer id="a1" />
      </ThinkingClocksProvider>,
    );
    act(() => void vi.advanceTimersByTime(20_000));
    const before = screen.getByTestId("line").textContent;
    rerender(<ThinkingClocksProvider>{null}</ThinkingClocksProvider>);
    rerender(
      <ThinkingClocksProvider>
        <Answer id="a1" />
      </ThinkingClocksProvider>,
    );
    expect(screen.getByTestId("line").textContent).toBe(before);
    expect(before).toMatch(/ 20 с$/);
  });

  it("ответ дописан — его часы забыты: новое ожидание с тем же id считает с нуля", () => {
    function Answer({ waiting }: { waiting: boolean }) {
      return (
        <ThinkingClockProvider id="a1" waiting={waiting}>
          <Line />
        </ThinkingClockProvider>
      );
    }
    function Line() {
      const { elapsed } = useThinkingStatus();
      return <p data-testid="line">{elapsed}</p>;
    }
    const { rerender } = render(
      <ThinkingClocksProvider>
        <Answer waiting />
      </ThinkingClocksProvider>,
    );
    act(() => void vi.advanceTimersByTime(7_000));
    rerender(
      <ThinkingClocksProvider>
        <Answer waiting={false} />
      </ThinkingClocksProvider>,
    );
    rerender(<ThinkingClocksProvider>{null}</ThinkingClocksProvider>);
    rerender(
      <ThinkingClocksProvider>
        <Answer waiting />
      </ThinkingClocksProvider>,
    );
    expect(screen.getByTestId("line").textContent).toBe("0 с");
  });
});
