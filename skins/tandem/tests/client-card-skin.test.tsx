// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { englishFlowLabels, FlowLabelsProvider, type ClientCardFieldView, type ClientCardPanelProps } from "@ykurilov/agent-chat-flows/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemClientCardSkin } from "../src/client-card";

afterEach(cleanup);

const { ClientCardPanel } = tandemClientCardSkin;

const field = (extra: Partial<ClientCardFieldView> = {}): ClientCardFieldView => ({
  fieldId: "name",
  name: "Имя",
  value: "Ольга",
  updatedAt: "13.10.2026",
  stale: false,
  busy: false,
  onForget: vi.fn(),
  ...extra,
});

const panel = (extra: Partial<ClientCardPanelProps> = {}): ClientCardPanelProps => ({
  state: "ready",
  fields: [field(), field({ fieldId: "channels", name: "Откуда приходят люди", value: "Инстаграм", stale: true })],
  forgettingAll: false,
  onForgetAll: vi.fn(),
  onRetry: vi.fn(),
  ...extra,
});

describe("скин карточки клиента Тандема", () => {
  it("заголовок, поля с значениями и датой, «может быть уже не так» только у устаревшего", () => {
    render(<ClientCardPanel {...panel()} />);

    expect(screen.getByRole("heading", { name: "Что агент знает о вас" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Имя")).toBeTruthy();
    expect(within(items[0]!).getByText("Ольга")).toBeTruthy();
    expect(within(items[0]!).getByText("обновлено 13.10.2026")).toBeTruthy();
    expect(within(items[0]!).queryByText("может быть уже не так")).toBeNull();
    expect(within(items[1]!).getByText("может быть уже не так")).toBeTruthy();
  });

  it("«Стереть» у поля зовёт onForget именно этого поля; занятое поле не нажимается", () => {
    const first = field();
    const second = field({ fieldId: "channels", name: "Откуда приходят люди", value: "Инстаграм", busy: true });
    render(<ClientCardPanel {...panel({ fields: [first, second] })} />);

    const buttons = screen.getAllByRole("button", { name: /^Стереть(?! всё)/ });
    fireEvent.click(buttons[0]!);
    expect(first.onForget).toHaveBeenCalledOnce();
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("«Стереть всё» сначала спрашивает; «Отмена» ничего не стирает, подтверждение — стирает", () => {
    const props = panel();
    render(<ClientCardPanel {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Стереть всё" }));
    expect(screen.getByText("Стереть всё, что агент знает о вас? Вернуть не получится.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(props.onForgetAll).not.toHaveBeenCalled();
    expect(screen.queryByText(/Вернуть не получится/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Стереть всё" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Стереть" }));
    expect(props.onForgetAll).toHaveBeenCalledOnce();
  });

  it("пусто — подпись «ничего не запомнил», кнопки «Стереть всё» нет", () => {
    render(<ClientCardPanel {...panel({ fields: [] })} />);

    expect(screen.getByText("Агент пока ничего о вас не запомнил.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Стереть всё" })).toBeNull();
  });

  it("загрузка и ошибка: подписи, «Повторить» зовёт onRetry", () => {
    const { rerender } = render(<ClientCardPanel {...panel({ state: "loading", fields: [] })} />);
    expect(screen.getByText("Загружаем…")).toBeTruthy();

    const props = panel({ state: "failed", fields: [] });
    rerender(<ClientCardPanel {...props} />);
    expect(screen.getByText("Не получилось загрузить. Попробуйте ещё раз")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it("идёт «стереть всё» — кнопки заняты", () => {
    render(<ClientCardPanel {...panel({ forgettingAll: true })} />);
    expect((screen.getByRole("button", { name: "Стереть всё" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("английские надписи берутся из FlowLabelsProvider", () => {
    render(
      <FlowLabelsProvider labels={englishFlowLabels}>
        <ClientCardPanel {...panel()} />
      </FlowLabelsProvider>,
    );
    expect(screen.getByRole("heading", { name: "What the agent knows about you" })).toBeTruthy();
    expect(screen.getAllByText("updated 13.10.2026")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Erase everything" })).toBeTruthy();
  });
});
