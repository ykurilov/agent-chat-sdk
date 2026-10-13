// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@tandem/ui";
import type { VoiceInputView } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemComposer } from "../src/composer";
import { TandemVoiceButton } from "../src/voice-button";

afterEach(cleanup);

const view = (override: Partial<VoiceInputView> = {}): VoiceInputView => ({
  state: "idle",
  onToggle: vi.fn(),
  ...override,
});

function renderButton(voice: VoiceInputView) {
  return render(
    <TooltipProvider>
      <TandemVoiceButton voice={voice} />
    </TooltipProvider>,
  );
}

describe("кнопка микрофона Тандема", () => {
  it("в покое подписана «Диктовать», не нажата", () => {
    renderButton(view());

    const button = screen.getByRole("button", { name: "Диктовать" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("при подключении подписана «Подключаемся…»; нажатие отменяет", () => {
    const voice = view({ state: "connecting" });
    renderButton(voice);

    fireEvent.click(screen.getByRole("button", { name: "Подключаемся к микрофону…" }));

    expect(voice.onToggle).toHaveBeenCalledOnce();
  });

  it("при записи подписана «Остановить диктовку», нажата", () => {
    renderButton(view({ state: "listening" }));

    const button = screen.getByRole("button", { name: "Остановить диктовку" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("пока запись заканчивается, кнопка не нажимается", () => {
    renderButton(view({ state: "stopping" }));

    expect((screen.getByRole("button", { name: "Остановить диктовку" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("пока сервер причёсывает текст, кнопка подписана «Приводим текст в порядок…», не нажимается, в ней тихий признак", () => {
    renderButton(view({ state: "stopping", polishing: true }));

    const button = screen.getByRole("button", { name: "Приводим текст в порядок…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("чистку слышит и экранный диктор: вежливое живое сообщение, пустое без чистки", () => {
    const { container, rerender } = renderButton(view({ state: "stopping" }));
    const liveRegion = () => container.querySelector("[aria-live=polite]");
    expect(liveRegion()?.textContent).toBe("");

    rerender(
      <TooltipProvider>
        <TandemVoiceButton voice={view({ state: "stopping", polishing: true })} />
      </TooltipProvider>,
    );

    expect(liveRegion()?.textContent).toBe("Приводим текст в порядок…");
    expect(liveRegion()?.className).toContain("sr-only");
  });

  it("без чистки кнопка не помечена занятой", () => {
    renderButton(view({ state: "stopping" }));

    expect(screen.getByRole("button", { name: "Остановить диктовку" }).getAttribute("aria-busy")).toBeNull();
  });

  it("нажатие в покое зовёт onToggle", () => {
    const voice = view();
    renderButton(voice);

    fireEvent.click(screen.getByRole("button", { name: "Диктовать" }));

    expect(voice.onToggle).toHaveBeenCalledOnce();
  });
});

describe("поле ввода Тандема: голос", () => {
  const renderComposer = (voice?: VoiceInputView) =>
    render(
      <TooltipProvider>
        <TandemComposer
          value=""
          onValueChange={vi.fn()}
          onSubmit={vi.fn()}
          canSubmit={false}
          busy={false}
          onStop={vi.fn()}
          {...(voice && { voice })}
        />
      </TooltipProvider>,
    );

  it("без голоса кнопки микрофона нет", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: "Диктовать" })).toBeNull();
  });

  it("с голосом кнопка рядом с полем, ошибка — сообщением", () => {
    renderComposer(view({ error: "Микрофон не найден" }));

    expect(screen.getByRole("button", { name: "Диктовать" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Микрофон не найден");
  });
});

describe("поле ввода Тандема: длинная диктовка", () => {
  const renderWithValue = (value: string, voice: VoiceInputView) => (
    <TooltipProvider>
      <TandemComposer value={value} onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit={false} busy={false} onStop={vi.fn()} voice={voice} />
    </TooltipProvider>
  );
  const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

  /** В jsdom нет вёрстки: высоту содержимого задаём сами. */
  function withScrollHeight(height: number) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => height });
  }
  afterEach(() => Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight"));

  it("пока идёт диктовка, поле прокручивается к последним словам", () => {
    withScrollHeight(500);
    const { rerender } = render(renderWithValue("Привет", view({ state: "listening" })));

    rerender(renderWithValue("Привет, мир", view({ state: "listening" })));

    expect(textarea().scrollTop).toBe(500);
  });

  it("исправленный текст после чистки тоже показан с конца, пока диктовка не закончилась", () => {
    withScrollHeight(500);
    const { rerender } = render(renderWithValue("ну э-э привет", view({ state: "stopping", polishing: true })));

    rerender(renderWithValue("Привет.", view({ state: "stopping", polishing: true })));

    expect(textarea().scrollTop).toBe(500);
  });

  function withClientHeight(height: number) {
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientHeight", { configurable: true, get: () => height });
  }
  afterEach(() => Reflect.deleteProperty(HTMLTextAreaElement.prototype, "clientHeight"));

  it("человек сам прокрутил вверх, чтобы перечитать, — новые слова его не тянут вниз", () => {
    withScrollHeight(500);
    withClientHeight(100);
    const { rerender } = render(renderWithValue("Привет", view({ state: "listening" })));
    textarea().scrollTop = 0;
    fireEvent.scroll(textarea());

    rerender(renderWithValue("Привет, мир", view({ state: "listening" })));

    expect(textarea().scrollTop).toBe(0);
  });

  it("вернул прокрутку к концу — диктовка снова ведёт поле за собой", () => {
    withScrollHeight(500);
    withClientHeight(100);
    const { rerender } = render(renderWithValue("Привет", view({ state: "listening" })));
    textarea().scrollTop = 0;
    fireEvent.scroll(textarea());
    textarea().scrollTop = 400;
    fireEvent.scroll(textarea());

    rerender(renderWithValue("Привет, мир", view({ state: "listening" })));

    expect(textarea().scrollTop).toBe(500);
  });

  it("новая диктовка снова ведёт поле, даже если прошлая осталась прокрученной вверх", () => {
    withScrollHeight(500);
    withClientHeight(100);
    const { rerender } = render(renderWithValue("Привет", view({ state: "listening" })));
    textarea().scrollTop = 0;
    fireEvent.scroll(textarea());
    rerender(renderWithValue("Привет", view({ state: "idle" })));

    rerender(renderWithValue("Привет", view({ state: "listening" })));
    rerender(renderWithValue("Привет, мир", view({ state: "listening" })));

    expect(textarea().scrollTop).toBe(500);
  });

  it("без диктовки поле не прокручивается: человек читает и правит где хочет", () => {
    withScrollHeight(500);
    const { rerender } = render(renderWithValue("Привет", view({ state: "idle" })));

    rerender(renderWithValue("Привет, мир", view({ state: "idle" })));

    expect(textarea().scrollTop).toBe(0);
  });
});

describe("поле ввода Тандема: курсор при замене надиктованного", () => {
  const renderWithValue = (value: string, voice: VoiceInputView) => (
    <TooltipProvider>
      <TandemComposer value={value} onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit={false} busy={false} onStop={vi.fn()} voice={voice} />
    </TooltipProvider>
  );
  const polishingView = view({ state: "stopping", polishing: true });
  const textarea = () => screen.getByRole("textbox") as HTMLTextAreaElement;

  /** Человек поставил курсор (или выделение) и поле об этом узнало. */
  function placeCaret(start: number, end = start) {
    textarea().setSelectionRange(start, end);
    fireEvent.select(textarea());
  }

  const before = "Слушай, ну э-э привет и всё";
  const after = "Слушай, Привет. и всё";
  // «ну э-э привет» (13 знаков) с 8-го знака заменены на «Привет.» (7 знаков).

  it("курсор в конце поля (после хвоста) остаётся в конце", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(before.length);

    rerender(renderWithValue(after, polishingView));

    expect(textarea().selectionStart).toBe(after.length);
    expect(textarea().selectionEnd).toBe(after.length);
  });

  it("курсор в хвосте остаётся на том же месте хвоста: сдвигается на разницу длин", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(before.length - 3); // перед «всё»

    rerender(renderWithValue(after, polishingView));

    expect(textarea().selectionStart).toBe(after.length - 3);
  });

  it("курсор до надиктованного (в набранном раньше) не двигается", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(3);

    rerender(renderWithValue(after, polishingView));

    expect(textarea().selectionStart).toBe(3);
  });

  it("курсор внутри заменённого куска встаёт в конец исправленного текста", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(12);

    rerender(renderWithValue(after, polishingView));

    expect(textarea().selectionStart).toBe("Слушай, Привет.".length);
  });

  it("замена и конец диктовки в одном обновлении: курсор всё равно сохраняется", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(before.length);

    rerender(renderWithValue(after, view({ state: "idle" })));

    expect(textarea().selectionStart).toBe(after.length);
  });

  it("выделение сохраняется как выделение", () => {
    const { rerender } = render(renderWithValue(before, polishingView));
    placeCaret(before.length - 3, before.length);

    rerender(renderWithValue(after, polishingView));

    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([after.length - 3, after.length]);
  });

  it("человек печатает во время чистки: его курсор не трогаем", () => {
    const { rerender } = render(renderWithValue("Привет", polishingView));
    textarea().value = "Приxвет";
    textarea().setSelectionRange(3, 3);
    fireEvent.input(textarea());

    rerender(renderWithValue("Приxвет", polishingView));

    expect(textarea().selectionStart).toBe(3);
  });

  it("не во время чистки поле ведёт себя как раньше: курсор не подстраиваем", () => {
    const { rerender } = render(renderWithValue("Привет", view({ state: "listening" })));
    placeCaret(0);

    rerender(renderWithValue("Привет, мир", view({ state: "listening" })));

    expect(textarea().selectionStart).not.toBe(0);
  });
});

describe("поле ввода Тандема: микрофон внутри рамки", () => {
  const modelChoice = {
    providers: [{ id: "openrouter", name: "OpenRouter", models: [{ id: "luna", name: "GPT 6 Luna" }] }],
    current: { providerId: "openrouter", modelId: "luna" },
    onChange: vi.fn(),
    reasoningLevels: [],
    reasoning: undefined,
    onReasoningChange: vi.fn(),
  };
  const attachments = { items: [], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "image/*" };
  const variants: Array<[string, Partial<ComponentProps<typeof TandemComposer>>]> = [
    ["простое (minimal)", {}],
    ["с выбором модели (extended)", { modelChoice }],
    ["полное (full: скрепка, модель)", { modelChoice, attachments }],
  ];

  function renderVariant(extra: Partial<ComponentProps<typeof TandemComposer>>, voice = view()) {
    return render(
      <TooltipProvider>
        <TandemComposer value="" onValueChange={vi.fn()} onSubmit={vi.fn()} canSubmit={false} busy={false} onStop={vi.fn()} voice={voice} {...extra} />
      </TooltipProvider>,
    );
  }

  it.each(variants)("%s: микрофон в рамке поля, в одном ряду с «Отправить», слева от неё", (_name, extra) => {
    renderVariant(extra);

    const mic = screen.getByRole("button", { name: "Диктовать" });
    const send = screen.getByRole("button", { name: "Отправить" });
    const frame = screen.getByRole("textbox").parentElement!;
    expect(frame.contains(mic)).toBe(true);
    expect(mic.parentElement).toBe(send.parentElement);
    expect(mic.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(variants)("%s: встроенного микрофона Тандема нет, кнопка одна", (_name, extra) => {
    renderVariant(extra);

    expect(screen.queryByRole("button", { name: "Надиктовать голосом" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Диктовать|Остановить диктовку/ })).toHaveLength(1);
  });

  it("стиль как у остальных значков ряда: прозрачная кнопка-значок, не рамочная, без внешних отступов", () => {
    renderVariant({ modelChoice, attachments });

    const mic = screen.getByRole("button", { name: "Диктовать" });
    const clip = screen.getByRole("button", { name: /Прикрепить/ });
    // Общие для ряда классы вида и размера у скрепки и микрофона одни и те же.
    const shared = (button: HTMLElement) => button.className.split(/\s+/).filter((name) => name.includes("text-[var(--foreground-muted)]") || name.includes("size-[var(--control-height-md)]") || name.includes("border-transparent"));
    expect(shared(mic).sort()).toEqual(shared(clip).sort());
    expect(mic.className).not.toContain("mb-1.5");
  });

  it("запись: кнопка нажата и подсвечена цветом действия, подпись «Остановить диктовку»", () => {
    renderVariant({}, view({ state: "listening" }));

    const mic = screen.getByRole("button", { name: "Остановить диктовку" });
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    expect(mic.className).toContain("text-[var(--action)]");
  });

  it("ошибка и признак чистки остаются: сообщение об ошибке под полем, живое сообщение рядом с кнопкой", () => {
    const { container } = renderVariant({}, view({ state: "stopping", polishing: true, error: "Микрофон не найден" }));

    expect(screen.getByText("Микрофон не найден")).toBeTruthy();
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Приводим текст в порядок…");
  });
});
