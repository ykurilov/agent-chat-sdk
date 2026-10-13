// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { russianLabels } from "@ykurilov/agent-chat-react";
import type { VoiceDialogView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemVoiceMenu } from "../src/voice-menu";

afterEach(cleanup);

const words = russianLabels.voiceDialog;
const voices = [
  { id: "anna", name: "Анна" },
  { id: "boris", name: "Борис" },
  { id: "vera", name: "Вера" },
];

const dialogView = (override: Partial<VoiceDialogView> = {}): VoiceDialogView => ({
  state: "listening",
  speechAvailable: true,
  voices,
  currentVoiceId: "boris",
  onSelectVoice: vi.fn(),
  onToggle: vi.fn(),
  ...override,
});

const renderMenu = (dialog: VoiceDialogView) =>
  render(
    <TooltipProvider>
      <TandemVoiceMenu dialog={dialog} />
    </TooltipProvider>,
  );

/** Меню открывается с клавиатуры: в jsdom нет настоящей мыши. */
function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("меню голосов Тандема", () => {
  it("нет списка голосов — меню не показывается", () => {
    const { container } = renderMenu(dialogView({ voices: undefined }));

    expect(container.firstChild).toBeNull();
  });

  it("список пуст — меню не показывается", () => {
    const { container } = renderMenu(dialogView({ voices: [] }));

    expect(container.firstChild).toBeNull();
  });

  it("один голос — меню не показывается", () => {
    const { container } = renderMenu(dialogView({ voices: [voices[0]!], currentVoiceId: "anna" }));

    expect(container.firstChild).toBeNull();
  });

  it("выбирать нечем (нет onSelectVoice) — меню не показывается", () => {
    const { container } = renderMenu(dialogView({ onSelectVoice: undefined }));

    expect(container.firstChild).toBeNull();
  });

  it("кнопка меню называет текущий голос, кнопка не меньше 44 пунктов", () => {
    renderMenu(dialogView());

    const trigger = screen.getByRole("button", { name: `${words.voiceMenu}: Борис` });
    expect(trigger.textContent).toContain("Борис");
    expect(trigger.style.minHeight).toBe("44px");
  });

  it("в списке все голоса, текущий отмечен", async () => {
    renderMenu(dialogView());

    openMenu(`${words.voiceMenu}: Борис`);

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Анна", "Борис", "Вера"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("выбор голоса зовёт onSelectVoice с его идентификатором", async () => {
    const dialog = dialogView();
    renderMenu(dialog);
    openMenu(`${words.voiceMenu}: Борис`);

    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Вера" }));

    expect(dialog.onSelectVoice).toHaveBeenCalledWith("vera");
  });

  it("текущего голоса нет в списке (устарел): кнопка называет просто «Голос», отмеченных нет", async () => {
    renderMenu(dialogView({ currentVoiceId: "deleted" }));

    openMenu(words.voiceMenu);

    const items = await screen.findAllByRole("menuitemradio");
    expect(items.every((item) => item.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("пункты списка не меньше 44 пунктов высотой", async () => {
    renderMenu(dialogView());
    openMenu(`${words.voiceMenu}: Борис`);

    const items = await screen.findAllByRole("menuitemradio");

    expect(items.every((item) => item.style.minHeight === "44px")).toBe(true);
  });
});
