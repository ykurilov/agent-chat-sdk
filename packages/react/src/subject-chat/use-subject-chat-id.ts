import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRefusal } from "../app-refusal";
import { serverRefusalOf } from "../server-refusal";

/** Чат объекта: ещё ищется, найден (id), сервер отказал с текстом или запрос не удался (можно повторить). */
export type SubjectChatState =
  | { state: "loading" }
  | { state: "ready"; chatId: string }
  | { state: "refused"; text: string }
  | { state: "failed" };

/**
 * `POST {api}/subject { key }` при открытии и смене ключа: сервер находит или создаёт чат объекта человека. Ответ
 * помнится вместе с запросом, на который он пришёл: при смене ключа прежний чат не показывается ни одного кадра.
 * Отказ самого приложения (`turn_refused`, `access_refused`) уходит в `onAppRefusal` — по разу на ответ сервера.
 */
export function useSubjectChatId(api: string, subject: string, onAppRefusal?: (refusal: AppRefusal) => void): SubjectChatState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const onAppRefusalRef = useRef(onAppRefusal);
  onAppRefusalRef.current = onAppRefusal;
  const request = `${attempt}\n${api}\n${subject}`;
  const [found, setFound] = useState<{ request: string; state: SubjectChatState } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const settle = (state: SubjectChatState) => {
      if (!controller.signal.aborted) setFound({ request, state });
    };
    void (async () => {
      try {
        const response = await fetch(`${api}/subject`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: subject }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const refusal = await serverRefusalOf(response);
          if (controller.signal.aborted) return;
          settle(refusal?.final ? { state: "refused", text: refusal.text } : { state: "failed" });
          if (refusal?.kind && refusal.code) onAppRefusalRef.current?.({ kind: refusal.kind, code: refusal.code, message: refusal.text });
          return;
        }
        const { id } = (await response.json()) as { id?: unknown };
        settle(typeof id === "string" ? { state: "ready", chatId: id } : { state: "failed" });
      } catch {
        settle({ state: "failed" });
      }
    })();
    return () => controller.abort();
  }, [api, subject, request]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { ...(found?.request === request ? found.state : { state: "loading" }), retry };
}
