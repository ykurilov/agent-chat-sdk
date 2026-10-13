import { vi } from "vitest";
import { pngBytes } from "./image-bytes";
import { json } from "./fake-runware";

export const KIE_KEY = "kie-key-0123456789";
export const KIE_URL = "https://api.kie.ai/api/v1";

/** Состояние задачи для `recordInfo`: по умолчанию готова, адрес по номеру задачи, без цены. */
export type KieTaskAnswer =
  | { state: "waiting" | "queuing" | "generating" }
  | { state: "success"; urls?: string[]; credits?: number }
  | { state: "fail"; failMsg?: string; credits?: number }
  | Response;

interface KieTask {
  number: number;
  taskId: string;
  model: string;
  input: Record<string, unknown>;
}

const resultUrl = (number: number, index = 0) => `https://tempfile.kie.test/${number}-${index}.png`;

/**
 * Поддельный KIE: `createTask` выдаёт `task-<n>` (n — порядок отправки, с 1), `recordInfo` отвечает тем, что тест
 * положил в `states[n]` (можно менять по ходу теста), картинки отдаются байтами PNG.
 */
export function fakeKie(options: { created?: Record<number, Response>; states?: Record<number, KieTaskAnswer> } = {}) {
  const tasks: KieTask[] = [];
  const states: Record<number, KieTaskAnswer> = { ...options.states };
  const checks: string[] = [];
  const downloads: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    init?.signal?.throwIfAborted();
    const url = String(input);
    if (url.endsWith("/jobs/createTask")) {
      const body = JSON.parse(String(init?.body)) as { model: string; input: Record<string, unknown> };
      const number = tasks.length + 1;
      const refusal = options.created?.[number];
      if (refusal) return refusal;
      tasks.push({ number, taskId: `task-${number}`, model: body.model, input: body.input });
      return json({ code: 200, msg: "success", data: { taskId: `task-${number}`, recordId: `task-${number}` } });
    }
    if (url.includes("/jobs/recordInfo")) {
      const taskId = new URL(url).searchParams.get("taskId") ?? "";
      checks.push(taskId);
      const task = tasks.find((item) => item.taskId === taskId);
      if (!task) return json({ code: 422, msg: "recordInfo is null", data: null });
      const answer = states[task.number] ?? { state: "success" };
      if (answer instanceof Response) return answer.clone();
      const base = { taskId, model: task.model, state: answer.state, failCode: null, failMsg: null, resultJson: "" };
      if (answer.state === "success") {
        const urls = answer.urls ?? [resultUrl(task.number)];
        return json({ code: 200, msg: "success", data: { ...base, resultJson: JSON.stringify({ resultUrls: urls }), ...(answer.credits !== undefined && { creditsConsumed: answer.credits }) } });
      }
      if (answer.state === "fail") {
        return json({ code: 200, msg: "success", data: { ...base, failCode: "500", failMsg: answer.failMsg ?? "Generation failed", ...(answer.credits !== undefined && { creditsConsumed: answer.credits }) } });
      }
      return json({ code: 200, msg: "success", data: base });
    }
    downloads.push(url);
    return new Response(pngBytes() as BodyInit);
  });
  return { fetch, tasks, states, checks, downloads, resultUrl };
}
