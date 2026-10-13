/** Подмена соединения сервера с Soniox: что отправлено — видно, ответы «приходят» по команде теста. */
export class FakeUpstream {
  static instances: FakeUpstream[] = [];
  readyState = 0;
  readonly sent: Array<string | ArrayBuffer | Uint8Array> = [];
  closed = false;
  private readonly handlers = new Map<string, Array<(event: object) => void>>();
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {
    FakeUpstream.instances.push(this);
  }
  addEventListener(type: string, handler: (event: object) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  send(data: string | ArrayBuffer | Uint8Array) {
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
  /** Сообщение как есть, без превращения в JSON (например, бинарное). */
  receiveRaw(data: unknown) {
    this.emit("message", { data });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.emit("close", { code });
  }
  fail() {
    this.emit("error");
    this.drop();
  }
  /** Разобранные JSON-сообщения, которые ушли в Soniox (звук пропущен). */
  get messages() {
    return this.sent.filter((item): item is string => typeof item === "string" && item.startsWith("{")).map((text) => JSON.parse(text) as Record<string, unknown>);
  }
}
