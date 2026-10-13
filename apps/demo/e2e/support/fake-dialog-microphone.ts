import type { Page } from "@playwright/test";

/**
 * Подмена микрофона для голосового режима («разговор»). Соединение с сервером настоящее: звук идёт на `/api/voice-dialog/stream`,
 * сервер демо в режиме `mock` отвечает по условным байтам звука (server/mock-soniox.ts, `createMockDialogSoniox`).
 * Настоящими остаются звуковой контекст, модуль захвата (грузится через `Blob`) и воспроизведение ответа: подменён только узел захвата,
 * в него тест «говорит» кусками. Так проверяется и то, что страница сама умеет открыть микрофон и проиграть звук.
 *
 * Условные байты куска: 0 — тишина, 1, 2 и 3 — фразы №1, №2 и №3 («не торопись пожалуйста»: ответ приходит не сразу), 4 — смех
 * (Soniox его не слышит как слова, а подмена Scribe — слышит), 255 — пауза, конец фразы.
 */
export const dialogSound = { silence: 0, phraseOne: 1, phraseTwo: 2, phraseThree: 3, laughter: 4, phraseEnd: 255 } as const;

interface FakeDialogMicrophoneOptions {
  /** `denied` — человек не дал доступ к микрофону; `missing` — в браузере нет API микрофона. */
  microphone?: "allowed" | "denied" | "missing";
}

interface DialogTestWindow {
  __dialogCapture?: { port: { onmessage: ((event: { data: Float32Array }) => void) | null }; context: AudioContext };
  __dialogContexts: AudioContext[];
  __dialogSourcesStarted: number;
}

export async function installFakeDialogMicrophone(page: Page, { microphone = "allowed" }: FakeDialogMicrophoneOptions = {}) {
  await page.addInitScript((mode) => {
    const testWindow = window as unknown as DialogTestWindow;
    testWindow.__dialogContexts = [];
    testWindow.__dialogSourcesStarted = 0;

    // Частота 16 кГц: одна выборка захвата — одна выборка звука для сервера, байты куска предсказуемы.
    const RealAudioContext = window.AudioContext;
    class DialogAudioContext extends RealAudioContext {
      constructor(options?: AudioContextOptions) {
        super({ ...options, sampleRate: 16_000 });
        testWindow.__dialogContexts.push(this);
      }
    }
    window.AudioContext = DialogAudioContext;

    // Сколько кусков озвучки поставлено играть: «ответ звучит».
    const realStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof realStart>) {
      testWindow.__dialogSourcesStarted += 1;
      return realStart.apply(this, args);
    };

    // Узел захвата: настоящий узел Web Audio, в который тест кладёт звук вместо микрофона.
    class DialogCaptureNode extends GainNode {
      port: { onmessage: ((event: { data: Float32Array }) => void) | null } = { onmessage: null };
      constructor(context: BaseAudioContext) {
        super(context);
        testWindow.__dialogCapture = { port: this.port, context: context as AudioContext };
      }
    }
    (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = DialogCaptureNode;

    if (mode === "missing") {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
      return;
    }
    let destination: MediaStreamAudioDestinationNode | undefined;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (mode === "denied") throw new DOMException("Permission denied", "NotAllowedError");
          destination ??= new DialogAudioContext().createMediaStreamDestination();
          return destination.stream;
        },
      },
    });
  }, microphone);
}

/** «Сказать»: микрофон отдаёт столько-то кусков по 40 мс, в каждом условный байт звука. */
export async function speakDialog(page: Page, sound: number, chunks = 1) {
  await page.evaluate(
    ({ byte, count }) => {
      const capture = (window as unknown as DialogTestWindow).__dialogCapture;
      if (!capture?.port.onmessage) throw new Error("Микрофон режима ещё не открыт");
      // Значение, при котором оба байта 16-битной выборки равны `byte` (для 255 это −1).
      const int16 = byte === 255 ? -1 : byte * 257;
      const value = int16 < 0 ? int16 / 32768 : int16 / 32767;
      for (let index = 0; index < count; index += 1) {
        capture.port.onmessage({ data: new Float32Array(Math.round(capture.context.sampleRate * 0.04)).fill(value) });
      }
    },
    { byte: sound, count: chunks },
  );
}

/** Сколько кусков озвучки поставлено играть с начала страницы. */
export function startedSounds(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as DialogTestWindow).__dialogSourcesStarted);
}

/** Состояния звуковых контекстов страницы: `running` после нажатия кнопки режима (разблокировка). */
export function audioContextStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as DialogTestWindow).__dialogContexts.map((context) => context.state));
}
