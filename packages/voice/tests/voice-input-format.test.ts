import { describe, expect, it } from "vitest";
import { createVoiceInput } from "../src/index";
import { createHarness, FakeMediaRecorder, FakeWebSocket } from "./support/fakes";
import type { Harness } from "./support/fakes";
import { vi } from "vitest";

async function recorderFormat(harness: Harness) {
  createVoiceInput(harness.options).start(harness.listener);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  harness.socket().open();
  await vi.waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
  return harness.recorder().options;
}

describe("формат записи выбирается явно", () => {
  it("webm/opus, если браузер его умеет (Chrome, Firefox)", async () => {
    const harness = createHarness();

    expect(await recorderFormat(harness)).toEqual({ mimeType: "audio/webm;codecs=opus" });
  });

  it("нет webm — ogg/opus", async () => {
    const harness = createHarness();
    FakeMediaRecorder.supportedTypes = ["audio/ogg;codecs=opus", "audio/mp4"];

    expect(await recorderFormat(harness)).toEqual({ mimeType: "audio/ogg;codecs=opus" });
  });

  it("только mp4 (Safari) — mp4", async () => {
    const harness = createHarness();
    FakeMediaRecorder.supportedTypes = ["audio/mp4"];

    expect(await recorderFormat(harness)).toEqual({ mimeType: "audio/mp4" });
  });

  it("браузер не назвал ни одного из форматов или не умеет `isTypeSupported` — формат по умолчанию", async () => {
    const harness = createHarness();
    FakeMediaRecorder.supportedTypes = [];
    expect(await recorderFormat(harness)).toBeUndefined();

    const second = createHarness();
    FakeMediaRecorder.supportedTypes = undefined;
    (FakeMediaRecorder as unknown as { isTypeSupported: unknown }).isTypeSupported = undefined;
    try {
      expect(await recorderFormat(second)).toBeUndefined();
    } finally {
      (FakeMediaRecorder as unknown as { isTypeSupported: unknown }).isTypeSupported = (type: string) =>
        FakeMediaRecorder.supportedTypes?.includes(type) ?? false;
    }
  });
});
