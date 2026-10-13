import type { UpstreamSocket } from "@ykurilov/agent-chat-voice/server";

/**
 * Поддельный Soniox для `transcribeAudioFile`: соединение открывается само, на «звука больше не будет» (пустая строка)
 * отвечает готовым текстом и закрывается нормально. Что ушло — видно в `sent`.
 */
export function createFakeSoniox(text: string) {
  const sessions: Array<{ url: string; config: Record<string, unknown>; audio: Uint8Array }> = [];

  function connectUpstream(url: string): UpstreamSocket {
    const handlers = new Map<string, Array<(event: object) => void>>();
    const emit = (type: string, event: object = {}) => {
      for (const handler of handlers.get(type) ?? []) handler(event);
    };
    const session = { url, config: {} as Record<string, unknown>, audio: new Uint8Array() };
    sessions.push(session);
    const socket = {
      readyState: 0,
      addEventListener(type: string, handler: (event: never) => void) {
        handlers.set(type, [...(handlers.get(type) ?? []), handler as (event: object) => void]);
      },
      send(data: string | Uint8Array) {
        if (typeof data !== "string") {
          session.audio = new Uint8Array([...session.audio, ...data]);
          return;
        }
        if (data.startsWith("{")) {
          session.config = JSON.parse(data) as Record<string, unknown>;
          return;
        }
        if (data !== "") return;
        emit("message", { data: JSON.stringify({ tokens: [{ text, is_final: true }] }) });
        emit("message", { data: JSON.stringify({ tokens: [], finished: true }) });
        socket.readyState = 3;
        emit("close", { code: 1000 });
      },
      close() {
        socket.readyState = 3;
      },
    };
    queueMicrotask(() => {
      socket.readyState = 1;
      emit("open");
    });
    return socket;
  }

  return { sessions, connectUpstream };
}
