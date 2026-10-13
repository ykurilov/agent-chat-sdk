import { Hono } from "hono";
import { makePng } from "./mock-png";

/*
 * Подмена Runware для стенда в режиме `mock`: настоящей сети нет, ответ идёт по сценарию из описания картинки.
 * Метки в описании ставит заглушка модели (mock-model.ts):
 *   `#fail:<метка>:<n>` — запрос с номером n среди запросов с этой меткой отклоняется (остальные удаются);
 *   `#slow:<метка>` — ответ держится до «Стопа» или до `slowMs` (настоящего долгого ожидания в тестах нет).
 * `GET /pending/<метка>` — сколько «медленных» запросов с этой меткой сейчас держится: тест ждёт по нему, что заказ дошёл до провайдера.
 * Готовая картинка отдаётся по адресу `…/images/<id>.png`, как отдаёт склад настоящего Runware.
 */

export const defaultSlowMs = 120_000;
const PICTURE_SIDE = 96;
const COST_USD = 0.0025;

interface TaskBody {
  taskUUID?: string;
  positivePrompt?: string;
}

/** Цвет картинки по её номеру: у трёх картинок одного заказа цвета разные. */
function colorOf(id: string): [number, number, number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [60 + (hash % 160), 60 + ((hash >> 8) % 160), 60 + ((hash >> 16) % 160)];
}

/** Ждёт `ms` или обрыва запроса («Стоп» хода обрывает запрос провайдеру). */
function holdUntilAborted(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

export function createMockRunware(options: { slowMs?: number } = {}): Hono {
  const slowMs = options.slowMs ?? defaultSlowMs;
  const requestsByLabel = new Map<string, number>();
  const pendingByLabel = new Map<string, number>();
  const app = new Hono();

  app.post("/v1", async (c) => {
    const [task = {}] = (await c.req.json().catch(() => [])) as TaskBody[];
    const prompt = task.positivePrompt ?? "";
    const fail = /#fail:([\w-]+):(\d+)/.exec(prompt);
    if (fail) {
      const number = (requestsByLabel.get(fail[1]!) ?? 0) + 1;
      requestsByLabel.set(fail[1]!, number);
      if (number === Number(fail[2])) {
        return c.json({ errors: [{ code: "contentPolicy", message: "Запрос отклонён модерацией" }] }, 400);
      }
    }
    const slow = /#slow:([\w-]+)/.exec(prompt);
    if (slow) {
      const label = slow[1]!;
      pendingByLabel.set(label, (pendingByLabel.get(label) ?? 0) + 1);
      await holdUntilAborted(c.req.raw.signal, slowMs);
      pendingByLabel.set(label, (pendingByLabel.get(label) ?? 1) - 1);
    }
    const address = new URL(c.req.url);
    const imageURL = `${address.origin}${address.pathname.replace(/\/v1$/, "")}/images/${crypto.randomUUID()}.png`;
    return c.json({ data: [{ taskUUID: task.taskUUID, imageURL, cost: COST_USD }] });
  });

  app.get("/pending/:label", (c) => c.json({ pending: pendingByLabel.get(c.req.param("label")) ?? 0 }));

  app.get("/images/:name", (c) => {
    const id = c.req.param("name").replace(/\.png$/, "");
    return new Response(Buffer.from(makePng(PICTURE_SIDE, colorOf(id))), { headers: { "content-type": "image/png" } });
  });

  return app;
}
