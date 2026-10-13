// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MessengerConnectPanelProps, MessengerConnectRowView } from "@ykurilov/agent-chat-messengers/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tandemMessengersSkin } from "../src/messengers";

afterEach(cleanup);

const { MessengerConnectPanel } = tandemMessengersSkin;

const rowOf = (messenger: MessengerConnectRowView["messenger"], extra: Partial<MessengerConnectRowView> = {}): MessengerConnectRowView => ({
  messenger,
  connected: null,
  busy: false,
  failed: false,
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  ...extra,
});

const renderPanel = (props: Partial<MessengerConnectPanelProps> = {}) => render(<MessengerConnectPanel state="ready" rows={[]} onRetry={vi.fn()} {...props} />);
const rowElement = (name: string) => screen.getByRole("group", { name });

describe("панель мессенджеров Тандема", () => {
  it("строка на каждый мессенджер приложения: не привязан — «Подключить»", () => {
    const telegram = rowOf("telegram");
    renderPanel({ rows: [telegram, rowOf("vk"), rowOf("max")] });
    expect(screen.getAllByRole("group").map((element) => element.getAttribute("aria-label"))).toEqual(["Telegram", "ВКонтакте", "MAX"]);
    fireEvent.click(within(rowElement("Telegram")).getByRole("button", { name: "Подключить" }));
    expect(telegram.onConnect).toHaveBeenCalledOnce();
    expect(within(rowElement("Telegram")).queryByText("Подключено")).toBeNull();
  });

  it("привязан: отметка «Подключено», имя в мессенджере и «Отвязать»", () => {
    const vk = rowOf("vk", { connected: { name: "Анна", username: "anna" } });
    renderPanel({ rows: [vk] });
    const row = rowElement("ВКонтакте");
    expect(within(row).getByText("Подключено")).toBeTruthy();
    expect(within(row).getByText("Анна (@anna)")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Подключить" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Отвязать" }));
    expect(vk.onDisconnect).toHaveBeenCalledOnce();
  });

  it("ссылка с кодом: подсказка, ссылка в новой вкладке, код и срок", () => {
    renderPanel({ rows: [rowOf("telegram", { offer: { url: "https://t.me/bot?start=K7", code: "K7", expiresAt: "до 12:35" } })] });
    const row = rowElement("Telegram");
    expect(within(row).getByText("Откройте ссылку в мессенджере и нажмите «Начать»")).toBeTruthy();
    const link = within(row).getByRole("link", { name: "Открыть в мессенджере" });
    expect(link.getAttribute("href")).toBe("https://t.me/bot?start=K7");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(within(row).getByText("Код: K7")).toBeTruthy();
    expect(within(row).getByText("до 12:35")).toBeTruthy();
  });

  it("запрос идёт — кнопка недоступна; запрос не прошёл — сообщение в строке", () => {
    renderPanel({ rows: [rowOf("telegram", { busy: true }), rowOf("max", { failed: true })] });
    expect((within(rowElement("Telegram")).getByRole("button", { name: "Подключить" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rowElement("MAX")).getByText("Не получилось. Попробуйте ещё раз")).toBeTruthy();
  });

  it("загрузка — надпись; список не загрузился — сообщение и «Повторить»", () => {
    renderPanel({ state: "loading" });
    expect(screen.getByText("Загружаем…")).toBeTruthy();
    cleanup();
    const onRetry = vi.fn();
    renderPanel({ state: "failed", onRetry });
    expect(screen.getByText("Не получилось. Попробуйте ещё раз")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
