// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientCardEntry } from "../../src/store/flow-store";
import { ClientCardPanel, useClientCard } from "../../src/react/client-card";
import type { ClientCardPanelProps, ClientCardSkin } from "../../src/react";

// T083: слой поведения экрана карточки — грузит карточку, готовит строки для скина, стирает поля.

afterEach(cleanup);

const NOW = Date.UTC(2026, 9, 13, 10);
const DAY = 24 * 60 * 60 * 1000;
const fields = [
  { id: "name", name: "Имя", refreshAfterMonths: null },
  { id: "course_topic", name: "Тема курса", refreshAfterMonths: null },
  { id: "channels", name: "Откуда приходят люди", refreshAfterMonths: 6 },
];
const entry = (fieldId: string, value: unknown, at = NOW): ClientCardEntry => ({ fieldId, value, updatedAt: new Date(at).toISOString(), chatId: "c", flowId: "f" });

function options(read: () => Promise<ClientCardEntry[]>, forget = vi.fn(async () => {})) {
  return { fields, read, forget, now: () => NOW, timeZone: "UTC" };
}

describe("T083 useClientCard", () => {
  it("грузит: сначала loading, потом строки по порядку полей сценария, с датой и пометкой «пора уточнить»", async () => {
    const read = vi.fn(async () => [entry("channels", "Инстаграм", NOW - 220 * DAY), entry("name", "Ольга"), entry("shoe_size", 42)]);
    const { result } = renderHook(() => useClientCard(options(read)));

    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.fields.map((field) => [field.fieldId, field.name, field.value, field.stale])).toEqual([
      ["name", "Имя", "Ольга", false],
      ["channels", "Откуда приходят люди", "Инстаграм", true],
      ["shoe_size", "shoe_size", "42", false],
    ]);
    expect(result.current.fields[0]!.updatedAt).toBe("13.10.2026");
  });

  it("факт (запись `fact:<id>`) — строка с именем «Факт», значение — текст; стирается по своему id", async () => {
    const forget = vi.fn(async () => {});
    const read = vi.fn(async () => [entry("name", "Ольга"), entry("fact:f1a2b3c4", "Ведёт блог")]);
    const { result } = renderHook(() => useClientCard({ ...options(read, forget), factName: "Факт" }));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.fields.map((field) => [field.fieldId, field.name, field.value, field.stale])).toEqual([
      ["name", "Имя", "Ольга", false],
      ["fact:f1a2b3c4", "Факт", "Ведёт блог", false],
    ]);
    act(() => result.current.fields[1]!.onForget());
    await waitFor(() => expect(forget).toHaveBeenCalledWith("fact:f1a2b3c4"));
  });

  it("не загрузилось — failed; «повторить» грузит снова", async () => {
    const read = vi.fn<() => Promise<ClientCardEntry[]>>().mockRejectedValueOnce(new Error("сеть")).mockResolvedValue([entry("name", "Ольга")]);
    const { result } = renderHook(() => useClientCard(options(read)));

    await waitFor(() => expect(result.current.state).toBe("failed"));
    act(() => result.current.onRetry());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.fields).toHaveLength(1);
  });

  it("стереть поле: busy на время стирания, потом строки нет; остальные на месте", async () => {
    let release: () => void = () => {};
    const forget = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const read = vi.fn(async () => [entry("name", "Ольга"), entry("course_topic", "Акварель")]);
    const { result } = renderHook(() => useClientCard(options(read, forget)));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => result.current.fields[0]!.onForget());
    await waitFor(() => expect(result.current.fields[0]!.busy).toBe(true));
    expect(forget).toHaveBeenCalledWith("name");
    expect(result.current.fields[1]!.busy).toBe(false);

    await act(async () => release());
    await waitFor(() => expect(result.current.fields.map((field) => field.fieldId)).toEqual(["course_topic"]));
  });

  it("стереть всё: forget('all'), список пуст", async () => {
    const forget = vi.fn(async () => {});
    const read = vi.fn(async () => [entry("name", "Ольга"), entry("course_topic", "Акварель")]);
    const { result } = renderHook(() => useClientCard(options(read, forget)));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    await act(async () => result.current.onForgetAll());
    expect(forget).toHaveBeenCalledWith("all");
    await waitFor(() => expect(result.current.fields).toEqual([]));
    expect(result.current.forgettingAll).toBe(false);
  });

  it("стереть не вышло — экран честно показывает ошибку, а не делает вид, что стёрто", async () => {
    const forget = vi.fn(async () => {
      throw new Error("нет связи");
    });
    const read = vi.fn(async () => [entry("name", "Ольга")]);
    const { result } = renderHook(() => useClientCard(options(read, forget)));
    await waitFor(() => expect(result.current.state).toBe("ready"));

    await act(async () => result.current.fields[0]!.onForget());
    await waitFor(() => expect(result.current.state).toBe("failed"));
  });
});

describe("T083 ClientCardPanel", () => {
  it("отдаёт скину готовые свойства", async () => {
    const seen: ClientCardPanelProps[] = [];
    const skin: ClientCardSkin = {
      ClientCardPanel: (props) => {
        seen.push(props);
        return <p data-testid="state">{props.state}:{props.fields.length}</p>;
      },
    };
    render(<ClientCardPanel skin={skin} {...options(async () => [entry("name", "Ольга")])} />);

    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("ready:1"));
    expect(seen[0]!.state).toBe("loading");
  });
});
