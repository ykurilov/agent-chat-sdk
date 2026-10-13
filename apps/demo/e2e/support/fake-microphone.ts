import type { Page } from "@playwright/test";

/**
 * Сценарий речи для заглушки Soniox на сервере демо (server/mock-soniox.ts): его выбирает первый байт первого куска звука.
 * `normal` — обычная речь, `slowPolish` — чистка отвечает 1,5 с, `failingPolish` — чистка ломается, `long` — длинная речь.
 */
export const speechScenario = { normal: 0, slowPolish: 1, failingPolish: 2, long: 3 } as const;

interface FakeMicrophoneOptions {
  /** `denied` — пользователь не дал доступ к микрофону. */
  microphone?: "allowed" | "denied";
  scenario?: (typeof speechScenario)[keyof typeof speechScenario];
}

/**
 * Подменяет в браузере только микрофон и запись: настоящих устройств нет. Соединение с сервером демо настоящее:
 * звук идёт на `/api/voice/stream`, сервер (в `mock`) отвечает по сценарию.
 * Куски звука идут только по команде теста (`speak`): так момент, когда пришли слова, не зависит от таймеров.
 */
export async function installFakeMicrophone(page: Page, { microphone = "allowed", scenario = speechScenario.normal }: FakeMicrophoneOptions = {}) {
  await page.addInitScript(
    ({ mode, scenarioByte }) => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (mode === "denied") throw new DOMException("Permission denied", "NotAllowedError");
            return { getTracks: () => [{ stop() {} }] };
          },
        },
      });

      class FakeMediaRecorder extends EventTarget {
        state = "inactive";
        constructor() {
          super();
          (window as unknown as { __fakeRecorder: FakeMediaRecorder }).__fakeRecorder = this;
        }
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.dispatchEvent(new Event("stop"));
        }
        pushChunk() {
          const event = new Event("dataavailable") as Event & { data: Blob };
          event.data = new Blob([new Uint8Array(16).fill(scenarioByte)]);
          this.dispatchEvent(event);
        }
      }
      (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
    },
    { mode: microphone, scenarioByte: scenario },
  );
}

/** «Сказать»: записывающее устройство отдаёт столько-то кусков звука. */
export async function speak(page: Page, chunks: number) {
  await page.evaluate((count) => {
    const recorder = (window as unknown as { __fakeRecorder: { pushChunk(): void } }).__fakeRecorder;
    for (let index = 0; index < count; index += 1) recorder.pushChunk();
  }, chunks);
}

/** Соединения голоса, которые видел браузер: адреса и всё, что по ним ушло и пришло. */
export function watchVoiceSockets(page: Page) {
  const sockets: Array<{ url: string; sent: Array<string | Buffer>; received: Array<string | Buffer> }> = [];
  page.on("websocket", (socket) => {
    const record = { url: socket.url(), sent: [] as Array<string | Buffer>, received: [] as Array<string | Buffer> };
    sockets.push(record);
    socket.on("framesent", (frame) => record.sent.push(frame.payload));
    socket.on("framereceived", (frame) => record.received.push(frame.payload));
  });
  return sockets;
}
