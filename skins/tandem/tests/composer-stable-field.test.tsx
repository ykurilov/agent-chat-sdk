// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import { AgentChat } from "@ykurilov/agent-chat-react";
import type { ComposerAttachments, ModelChoiceView, VoiceInputView } from "@ykurilov/agent-chat-react";
import { useState } from "react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { installFakeLayout } from "../../../packages/react/tests/support/fake-layout";
import { tandemSkin } from "../src";
import { TandemComposer } from "../src/composer";

let layout: ReturnType<typeof installFakeLayout>;
beforeEach(() => {
  layout = installFakeLayout();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  layout.uninstall();
});

/**
 * Поздние части панели ввода (меню моделей, уровни рассуждений, вложения, голос, кнопки приложения, лимит) приходят,
 * когда человек уже печатает. Поле при этом то же самое: не пересоздаётся, черновик и фокус на месте.
 */

const menu = (override: Partial<ModelChoiceView> = {}): ModelChoiceView => ({
  providers: [{ id: "openrouter", name: "OpenRouter", models: [{ id: "gpt-6-luna", name: "GPT 6 Luna" }] }],
  current: { providerId: "openrouter", modelId: "gpt-6-luna" },
  onChange: vi.fn(),
  reasoningLevels: [],
  reasoning: "",
  onReasoningChange: vi.fn(),
  ...override,
});
const loadingMenu = menu({ providers: [] });
const attachments: ComposerAttachments = { items: [], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/png" };
const voice: VoiceInputView = { state: "idle", onToggle: vi.fn() };

type LateProps = Partial<ComponentProps<typeof TandemComposer>>;

/** Поле с настоящим черновиком: значение живёт в состоянии, как у слоя поведения. */
function Field({ late }: { late: LateProps }) {
  const [value, setValue] = useState("");
  return (
    <TooltipProvider>
      <TandemComposer value={value} onValueChange={setValue} onSubmit={vi.fn()} busy={false} onStop={vi.fn()} {...late} />
    </TooltipProvider>
  );
}

const field = () => screen.getByLabelText("Сообщение") as HTMLTextAreaElement;

const cases: Array<[string, LateProps, LateProps]> = [
  ["меню моделей пришло", { modelChoice: loadingMenu }, { modelChoice: menu() }],
  ["меню моделей пришло, когда выбора ещё не было вовсе", {}, { modelChoice: menu() }],
  ["права пришли без выбора модели", { modelChoice: loadingMenu }, {}],
  ["пришли уровни рассуждений", { modelChoice: menu() }, { modelChoice: menu({ reasoningLevels: [{ id: "low", name: "Низкий" }, { id: "high", name: "Высокий" }], reasoning: "low" }) }],
  ["пришли вложения", { modelChoice: loadingMenu }, { modelChoice: loadingMenu, attachments }],
  ["вложения убраны правами", { attachments }, {}],
  ["вложения и меню вместе", {}, { attachments, modelChoice: menu() }],
  ["пришёл голос", {}, { voice }],
  ["пришли кнопки приложения", {}, { actions: <button type="button">Шаблон</button> }],
  ["лимит остановил отправку", {}, { sendingBlocked: true }],
];

describe("поле ввода Тандема: поздние части не пересоздают поле", () => {
  it.each(cases)("%s: то же поле, черновик и фокус на месте", (_name, before, after) => {
    const { rerender } = render(<Field late={before} />);
    const typed = field();
    act(() => typed.focus());
    fireEvent.change(typed, { target: { value: "Хочу записаться на" } });
    rerender(<Field late={after} />);
    expect(field()).toBe(typed);
    expect(field().value).toBe("Хочу записаться на");
    if (!after.sendingBlocked) expect(document.activeElement).toBe(typed);
  });

  it("чат целиком: человек начал печатать до списка моделей — список пришёл, поле то же, текст на месте", async () => {
    const server = fakeChatServer();
    let releaseMenu: () => void = () => {};
    server.state.gate.models = new Promise<void>((resolve) => (releaseMenu = resolve));
    vi.stubGlobal("fetch", server.fetch);
    render(<AgentChat api="/api/chat" chatId="c1" skin={tandemSkin} />);
    await waitFor(() => expect(server.requestsTo("models")).toHaveLength(1));
    const typed = field();
    act(() => typed.focus());
    fireEvent.change(typed, { target: { value: "Хочу записаться на" } });
    act(() => releaseMenu());
    await waitFor(() => expect(screen.getByText("DeepSeek 4.1 Flash")).toBeTruthy());
    expect(field()).toBe(typed);
    expect(field().value).toBe("Хочу записаться на");
    expect(document.activeElement).toBe(typed);
  });
});
