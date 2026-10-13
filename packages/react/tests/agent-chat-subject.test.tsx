// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/agent-chat";
import type { AttachmentsPlugin } from "../src/attachments-contract";
import type { ChatSkin, GeneratedImagesView, MediaViewerProps } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const greeting = { id: "g1", role: "assistant" as const, parts: [{ type: "text", text: "Здравствуйте! Начнём урок." }] };

/** Сервер-заглушка с адресом `POST {api}/subject`: ответ по ключу задаёт тест, остальное — обычный сервер чата c1. */
function withSubjectRoute(server: ReturnType<typeof fakeChatServer>, answer: (key: string) => Response | Promise<Response>) {
  const subjectCalls: Array<{ key: string }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/chat/subject" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { key: string };
      subjectCalls.push(body);
      return answer(body.key);
    }
    return server.fetch(input, init);
  });
  vi.stubGlobal("fetch", fetch);
  return { subjectCalls };
}

describe("AgentChat: чат объекта (subject)", () => {
  it("при открытии просит сервер чат по ключу и дальше работает как обычный чат с его id", async () => {
    const server = fakeChatServer({ history: [greeting] });
    const { subjectCalls } = withSubjectRoute(server, () => Response.json({ id: "c1", created: true }));
    render(<AgentChat api="/api/chat" subject="lesson:demo" skin={stubSkin} />);
    await screen.findByText("Здравствуйте! Начнём урок.");
    expect(subjectCalls).toEqual([{ key: "lesson:demo" }]);
    expect(server.requests.some((request) => request.url === "/api/chat/c1" && request.method === "GET")).toBe(true);
  });

  it("отказ сервера — текст отказа в ErrorNotice, истории не запрашивается", async () => {
    const server = fakeChatServer();
    withSubjectRoute(server, () => Response.json({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок ещё закрыт." } }, { status: 403 }));
    render(<AgentChat api="/api/chat" subject="lesson:closed" skin={stubSkin} />);
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-kind="error-notice"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(notice.textContent).toContain("Урок ещё закрыт.");
    expect(server.requests).toHaveLength(0);
  });

  it("отказ сервера: onTurnRefused один раз с видом, кодом и словами; «Повторить» спрашивает сервер снова", async () => {
    const onTurnRefused = vi.fn();
    const server = fakeChatServer({ history: [greeting] });
    let refuse = true;
    const { subjectCalls } = withSubjectRoute(server, () =>
      refuse
        ? Response.json({ error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу." } }, { status: 403 })
        : Response.json({ id: "c1", created: false }),
    );
    render(<AgentChat api="/api/chat" subject="lesson:closed" skin={stubSkin} onTurnRefused={onTurnRefused} />);
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-kind="error-notice"]');
      expect(found?.textContent).toContain("Нужен доступ к курсу.");
      return found!;
    });
    expect(onTurnRefused).toHaveBeenCalledTimes(1);
    expect(onTurnRefused).toHaveBeenCalledWith({ kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу." });

    refuse = false;
    act(() => fireEvent.click(notice.querySelector("button")!));
    await screen.findByText("Здравствуйте! Начнём урок.");
    expect(subjectCalls).toHaveLength(2);
    expect(onTurnRefused).toHaveBeenCalledTimes(1);
  });

  it("пока чат ищется — каркас обычного чата (лента и поле ввода), а не пустота", async () => {
    withSubjectRoute(fakeChatServer(), () => new Promise<Response>(() => {}));
    render(<AgentChat api="/api/chat" subject="lesson:demo" skin={stubSkin} />);
    expect(screen.getByTestId("feed")).toBeTruthy();
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("смена subject: прежний чат пропадает сразу, ещё до ответа сервера о новом", async () => {
    const server = fakeChatServer({ history: [greeting] });
    withSubjectRoute(server, (key) => (key === "lesson:a" ? Response.json({ id: "c1", created: false }) : new Promise<Response>(() => {})));
    const { rerender } = render(<AgentChat api="/api/chat" subject="lesson:a" skin={stubSkin} />);
    await screen.findByText("Здравствуйте! Начнём урок.");
    rerender(<AgentChat api="/api/chat" subject="lesson:b" skin={stubSkin} />);
    expect(screen.queryByText("Здравствуйте! Начнём урок.")).toBeNull();
    expect(screen.getByTestId("feed")).toBeTruthy();
  });

  it("сеть упала — ошибка с «Повторить»; повтор находит чат", async () => {
    const server = fakeChatServer({ history: [greeting] });
    let calls = 0;
    const { subjectCalls } = withSubjectRoute(server, () => {
      if (++calls === 1) throw new TypeError("Failed to fetch");
      return Response.json({ id: "c1", created: false });
    });
    render(<AgentChat api="/api/chat" subject="lesson:demo" skin={stubSkin} />);
    const notice = await waitFor(() => {
      const found = document.querySelector('[data-kind="error-notice"]');
      expect(found).not.toBeNull();
      return found!;
    });
    act(() => fireEvent.click(notice.querySelector("button")!));
    await screen.findByText("Здравствуйте! Начнём урок.");
    expect(subjectCalls).toHaveLength(2);
    expect(document.querySelector('[data-kind="error-notice"]')).toBeNull();
  });

  it("повторное открытие снова спрашивает сервер и показывает тот же чат с одним приветствием", async () => {
    const server = fakeChatServer({ history: [greeting] });
    const { subjectCalls } = withSubjectRoute(server, () => Response.json({ id: "c1", created: false }));
    const first = render(<AgentChat api="/api/chat" subject="lesson:demo" skin={stubSkin} />);
    await screen.findByText("Здравствуйте! Начнём урок.");
    first.unmount();
    render(<AgentChat api="/api/chat" subject="lesson:demo" skin={stubSkin} />);
    await screen.findByText("Здравствуйте! Начнём урок.");
    expect(screen.getAllByText("Здравствуйте! Начнём урок.")).toHaveLength(1);
    expect(subjectCalls).toEqual([{ key: "lesson:demo" }, { key: "lesson:demo" }]);
  });

  it("chatId и subject вместе — ошибка разработчика", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AgentChat api="/api/chat" chatId="c1" subject="lesson:demo" skin={stubSkin} />)).toThrow(/either chatId or subject/);
    quiet.mockRestore();
  });
});

function GeneratedImages({ items }: GeneratedImagesView) {
  return (
    <div data-kind="images">
      {items.map((item) =>
        item.state === "ready" ? (
          <button key={item.key} type="button" data-image={item.key} data-src={item.src} onClick={(event) => item.onOpen(event.currentTarget)}>
            {item.alt}
          </button>
        ) : null,
      )}
    </div>
  );
}
function MediaViewer({ items }: MediaViewerProps) {
  return <div role="dialog" data-keys={items.map((item) => item.key).join(",")} />;
}

const imagesPlugin: AttachmentsPlugin = {
  useController: () => ({
    composer: { items: [], onAddFiles: () => {}, onRemove: () => {}, accept: "image/*" },
    ready: true,
    hasFiles: false,
    readFiles: () => [],
    markSent: () => {},
    restoreFiles: () => {},
    // Как настоящий плагин: только части `attachment:`, вид по типу. Порядок — обратный: лента не должна на него опираться.
    describe: (message) => {
      const items = message.parts.flatMap((part) => {
        if (part.type !== "file" || !part.url.startsWith("attachment:")) return [];
        const id = part.url.slice("attachment:".length);
        const kind = part.mediaType.startsWith("image/") ? ("image" as const) : ("file" as const);
        return [{ id, partUrl: part.url, name: part.filename ?? "файл", kind, url: `/api/chat/c1/attachments/${id}`, mediaType: part.mediaType }];
      });
      return items.length > 0 ? { label: "Вложения", items: items.reverse() } : undefined;
    },
  }),
};

describe("AgentChat: картинка в ответе агента", () => {
  it("часть file в ответе агента рисуется картинкой через GeneratedImages и открывается в окне просмотра", async () => {
    const history = [
      { id: "a1", role: "assistant" as const, parts: [{ type: "text", text: "Вот схема" }, { type: "file", url: "attachment:img1", mediaType: "image/png", filename: "схема.png" }] },
    ];
    renderAgentChat(fakeChatServer({ history }), { skin: { ...stubSkin, GeneratedImages, MediaViewer } as ChatSkin, attachments: imagesPlugin });
    await screen.findByText("Вот схема");
    const image = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[data-image="img1"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(image.dataset.src).toBe("/api/chat/c1/attachments/img1");
    expect(image.textContent).toBe("схема.png");
    image.click();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')?.getAttribute("data-keys")).toBe("img1"));
  });

  it("часть сопоставляется с вложением по адресу; не картинка — ссылкой на файл, а не пропадает", async () => {
    const history = [
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          { type: "file", url: "attachment:doc1", mediaType: "application/pdf", filename: "отчёт.pdf" },
          { type: "file", url: "attachment:img1", mediaType: "image/png", filename: "схема.png" },
          { type: "file", url: "https://example.com/внешний.txt", mediaType: "text/plain", filename: "внешний.txt" },
        ],
      },
    ];
    renderAgentChat(fakeChatServer({ history }), { skin: { ...stubSkin, GeneratedImages, MediaViewer } as ChatSkin, attachments: imagesPlugin });
    const image = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[data-image="img1"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(image.textContent).toBe("схема.png");
    expect(document.querySelectorAll("[data-image]")).toHaveLength(1);
    const texts = [...document.querySelectorAll('[data-kind="text"]')].map((node) => node.textContent);
    expect(texts).toEqual(["📎 [отчёт.pdf](</api/chat/c1/attachments/doc1>)", "📎 внешний.txt"]);
  });

  it("скин без GeneratedImages — картинка ответа ссылкой на файл", async () => {
    const history = [{ id: "a1", role: "assistant" as const, parts: [{ type: "file", url: "attachment:img1", mediaType: "image/png", filename: "схема [1].png" }] }];
    renderAgentChat(fakeChatServer({ history }), { skin: stubSkin, attachments: imagesPlugin });
    await waitFor(() => expect(document.querySelector('[data-kind="text"]')?.textContent).toBe("📎 [схема \\[1\\].png](</api/chat/c1/attachments/img1>)"));
  });
});
