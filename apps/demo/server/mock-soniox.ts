import type { UpstreamSocket } from "@ykurilov/agent-chat-voice/server";

/**
 * Подмена Soniox для стенда в режиме `mock`: настоящей сети нет, речь идёт по сценарию.
 * Сценарий выбирает первый байт первого куска звука (его задаёт e2e, см. e2e/support/fake-microphone.ts):
 *   0 — обычная речь, 1 — то же, но чистка отвечает медленно, 2 — то же, но чистка ломается, 3 — длинная речь (поле прокручивается).
 * Ход речи: после 2-го куска звука — предварительное слово, после 4-го — закреплённое начало и предварительный хвост,
 * на «закрепи всё» — закреплённый хвост и метка `<fin>`.
 */
export const mockSpeech = {
  normal: { settled: "ну э-э привет", tail: " как бы мир" },
  slowPolish: { settled: "ну э-э медленно", tail: " как бы мир" },
  failingPolish: { settled: "ну э-э сбой", tail: " как бы мир" },
  long: { settled: `ну э-э ${"длинная фраза ".repeat(150)}`.trimEnd(), tail: " как бы конец" },
} as const;

const speechByScenario = [mockSpeech.normal, mockSpeech.slowPolish, mockSpeech.failingPolish, mockSpeech.long];
const INTERIM_AT_CHUNK = 2;
const SETTLED_AT_CHUNK = 4;
const OPEN_DELAY_MS = 10;

type Handler = (event: object) => void;

export function createMockSoniox(): UpstreamSocket {
  const handlers = new Map<string, Handler[]>();
  let chunks = 0;
  let speech: (typeof speechByScenario)[number] = mockSpeech.normal;
  let closed = false;

  const emit = (type: string, event: object = {}) => {
    for (const handler of handlers.get(type) ?? []) handler(event);
  };
  const reply = (tokens: Array<{ text: string; is_final: boolean }>) => {
    if (!closed) emit("message", { data: JSON.stringify({ tokens }) });
  };

  const socket: UpstreamSocket = {
    readyState: 0,
    send(data) {
      if (typeof data === "string") {
        if (data.startsWith("{") && (JSON.parse(data) as { type?: string }).type === "finalize") {
          reply([
            { text: speech.tail, is_final: true },
            { text: "<fin>", is_final: true },
          ]);
        }
        return;
      }
      chunks += 1;
      if (chunks === 1) speech = speechByScenario[data[0] ?? 0] ?? mockSpeech.normal;
      if (chunks === INTERIM_AT_CHUNK) reply([{ text: speech.settled.split(" ").slice(0, 1).join(" "), is_final: false }]);
      if (chunks === SETTLED_AT_CHUNK) {
        reply([
          { text: speech.settled, is_final: true },
          { text: speech.tail, is_final: false },
        ]);
      }
    },
    close() {
      closed = true;
      socket.readyState = 3;
    },
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler as Handler]);
    },
  };
  setTimeout(() => {
    if (closed) return;
    socket.readyState = 1;
    emit("open");
  }, OPEN_DELAY_MS);
  return socket;
}

/** Чистка для стенда в режиме `mock`: убирает «ну», «э-э», «как бы», ставит заглавную и точку. «медленно» в тексте — ответ через 1,5 с, «сбой» — ошибка. */
export async function mockPolish(text: string): Promise<string> {
  if (text.includes("медленно")) await new Promise((resolve) => setTimeout(resolve, 1500));
  if (text.includes("сбой")) throw new Error("Заглушка чистки: сбой по сценарию");
  const cleaned = text
    .replaceAll("как бы", " ")
    .split(/\s+/)
    .filter((word) => word !== "" && word !== "ну" && word !== "э-э")
    .join(" ");
  return cleaned ? `${cleaned[0]!.toUpperCase()}${cleaned.slice(1)}.` : "";
}

/** Условные байты звука для диалога: тишина, начало фразы №1 или №2 (первый байт куска), конец фразы. */
export const MOCK_SILENCE_BYTE = 0;
export const MOCK_PHRASE_END_BYTE = 255;
/** Смех: его слышит подмена Scribe, а Soniox слов в нём не находит. */
export const MOCK_LAUGH_BYTE = 4;

/** Фраза №1 — обычная реплика, фраза №2 — слова остановки (перебивание), фраза №3 — вопрос, на который заглушка модели отвечает не сразу. */
export const mockDialogPhrases = ["привет как дела", "стоп хватит", "не торопись пожалуйста"] as const;

const DIALOG_CONFIDENCE = 0.95;

/**
 * Подмена Soniox для голосового диалога в режиме `mock`. Речь идёт по условным байтам звука
 * (первый байт куска, его задаёт e2e): `0` — тишина, `1`, `2` и `3` — фразы №1, №2 и №3, `255` — пауза, конец фразы.
 * Каждый кусок фразы добавляет слово: предыдущее закрепляется, новое приходит предварительным.
 * На конец фразы закрепляются все оставшиеся слова и приходит метка `<end>`. Конец без речи ничего не выдаёт.
 */
export function createMockDialogSoniox(): UpstreamSocket {
  const handlers = new Map<string, Handler[]>();
  let closed = false;
  let words: string[] = [];
  let heardWords = 0;
  let settledWords = 0;

  const emit = (type: string, event: object = {}) => {
    for (const handler of handlers.get(type) ?? []) handler(event);
  };
  const token = (index: number, isFinal: boolean) => ({
    text: index === 0 ? words[index]! : ` ${words[index]!}`,
    is_final: isFinal,
    confidence: DIALOG_CONFIDENCE,
  });
  const reply = (tokens: object[]) => {
    if (!closed && tokens.length > 0) emit("message", { data: JSON.stringify({ tokens }) });
  };

  function hear(byte: number) {
    if (words.length === 0) {
      words = (mockDialogPhrases[byte - 1] ?? mockDialogPhrases[0]).split(" ");
      heardWords = 0;
      settledWords = 0;
    }
    if (heardWords >= words.length) return;
    heardWords += 1;
    const tokens: object[] = [];
    while (settledWords < heardWords - 1) tokens.push(token(settledWords++, true));
    tokens.push(token(heardWords - 1, false));
    reply(tokens);
  }

  function endPhrase() {
    if (words.length === 0) return;
    const tokens: object[] = [];
    while (settledWords < words.length) tokens.push(token(settledWords++, true));
    tokens.push({ text: "<end>", is_final: true, confidence: 1 });
    reply(tokens);
    words = [];
  }

  const socket: UpstreamSocket = {
    readyState: 0,
    send(data) {
      if (typeof data === "string" || closed) return;
      const byte = data[0] ?? MOCK_SILENCE_BYTE;
      if (byte === MOCK_SILENCE_BYTE || byte === MOCK_LAUGH_BYTE) return;
      if (byte === MOCK_PHRASE_END_BYTE) endPhrase();
      else hear(byte);
    },
    close() {
      closed = true;
      socket.readyState = 3;
    },
    addEventListener(type, handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler as Handler]);
    },
  };
  setTimeout(() => {
    if (closed) return;
    socket.readyState = 1;
    emit("open");
  }, OPEN_DELAY_MS);
  return socket;
}
