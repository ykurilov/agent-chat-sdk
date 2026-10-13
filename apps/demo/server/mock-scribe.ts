/**
 * Подмена Scribe для стенда в режиме `mock`: сети нет. Звук слушается по условным байтам (их задаёт e2e,
 * см. e2e/support/fake-dialog-microphone.ts): кусок с байтом `4` — смех, остальное — тишина или речь.
 * Ответ приходит сразу и в той же форме, что у Scribe: звук — слово типа `audio_event`.
 */
export const MOCK_LAUGH_BYTE = 4;
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SECOND = 32_000;

export function createMockScribe(): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const file = (init?.body as FormData).get("file") as File;
    const pcm = new Uint8Array(await file.arrayBuffer()).subarray(WAV_HEADER_BYTES);
    const first = pcm.indexOf(MOCK_LAUGH_BYTE);
    const words =
      first < 0
        ? []
        : [{ type: "audio_event", text: "(laughter)", start: first / BYTES_PER_SECOND, end: Math.min(pcm.length, first + BYTES_PER_SECOND / 2) / BYTES_PER_SECOND, logprob: 0 }];
    return { ok: true, status: 200, json: async () => ({ language_code: "rus", text: "", words }) };
  }) as unknown as typeof fetch;
}
