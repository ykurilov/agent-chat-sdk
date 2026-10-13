/** Подмена исходящего WebSocket сервера (к Soniox или ElevenLabs): что отправлено — видно, ответы «приходят» по команде теста. */
export class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: Array<string | Uint8Array> = [];
  closed = false;
  private readonly handlers = new Map<string, Array<(event: object) => void>>();

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: object) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  private emit(type: string, event: object = {}) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  receive(message: unknown) {
    this.emit("message", { data: typeof message === "string" ? message : JSON.stringify(message) });
  }

  /** Сокет оборвался сам (не закрыт нашей стороной). */
  drop(code = 1006) {
    this.readyState = 3;
    this.emit("close", { code });
  }

  fail() {
    this.emit("error");
    this.drop();
  }

  /** Разобранные JSON-сообщения, которые ушли по сокету (звук пропущен). */
  get messages() {
    return this.sent.filter((item): item is string => typeof item === "string" && item.startsWith("{")).map((text) => JSON.parse(text) as Record<string, unknown>);
  }

  /** Куски звука, ушедшие по сокету. */
  get audio() {
    return this.sent.filter((item): item is Uint8Array => typeof item !== "string");
  }
}

export const connectFake = (url: string, headers: Record<string, string>) => new FakeSocket(url, headers) as never;

/** Звук ElevenLabs как в настоящем ответе: base64 от PCM. */
export function base64Pcm(byteLength: number, fill = 1): string {
  return Buffer.from(new Uint8Array(byteLength).fill(fill)).toString("base64");
}

/** PCM 24 кГц s16 моно: 48 000 байт = 1 секунда. */
export const BYTES_PER_SECOND = 48_000;
export const bytesFor = (ms: number) => (ms * BYTES_PER_SECOND) / 1000;

/** Ответ ElevenLabs: кусок звука длиной `ms` и метки времени знаков `text` внутри куска (по `stepMs` на знак). */
export function speechChunk(text: string, ms: number, stepMs = 50) {
  const chars = [...text];
  return {
    audio: base64Pcm(bytesFor(ms)),
    alignment: {
      chars,
      char_start_times_ms: chars.map((_, index) => index * stepMs),
      char_durations_ms: chars.map(() => stepMs),
    },
  };
}
