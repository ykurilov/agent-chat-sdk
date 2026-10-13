/** Подмена Web Audio для тестов: ничего не играет, только записывает, что с ним делали. */

export class FakeBuffer {
  readonly duration: number;
  private readonly channel: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.channel = new Float32Array(length);
  }
  getChannelData(_channel: number): Float32Array {
    return this.channel;
  }
  copyToChannel(source: Float32Array, _channel: number): void {
    this.channel.set(source);
  }
}

export class FakeSource {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopCalls = 0;
  connectedTo: unknown = null;
  disconnected = false;
  connect(node: unknown) {
    this.connectedTo = node;
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {
    this.stopCalls += 1;
  }
  /** Доиграл до конца. */
  finish() {
    this.onended?.();
  }
}

export class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  state: "suspended" | "running" | "closed" | "interrupted" = "suspended";
  sampleRate = 48_000;
  destination = { kind: "destination" };
  sources: FakeSource[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  /** Что происходило, в порядке вызовов: чтобы проверить, что разблокировка вся внутри одного нажатия. */
  log: string[] = [];
  constructor(readonly options?: unknown) {
    super();
    FakeAudioContext.instances.push(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async resume() {
    this.resumeCalls += 1;
    this.log.push("resume");
    this.state = "running";
  }
  async close() {
    this.closeCalls += 1;
    this.state = "closed";
  }
}

export function pcm16(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** `ms` миллисекунд звука 24 кГц (по умолчанию тишина). */
export function speechPcm(ms: number, value = 0): Uint8Array {
  return pcm16(new Array<number>(Math.round((24_000 * ms) / 1000)).fill(value));
}
