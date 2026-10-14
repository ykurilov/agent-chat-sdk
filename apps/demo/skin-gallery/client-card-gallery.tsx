import { ClientCardPanel } from "@ykurilov/agent-chat-flows/react";
import type { ClientCardEntry } from "@ykurilov/agent-chat-flows";
import { AgentMemory, type MemoryApi, type MemoryNote } from "@ykurilov/agent-chat-react";
import { tandemClientCardSkin } from "@ykurilov/agent-chat-skin-tandem/client-card";
import { tandemMemorySkin } from "@ykurilov/agent-chat-skin-tandem";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина экрана карточки клиента (этап 8 плана 058): без сервера, рядом с экраном памяти — так их ставит приложение.
 * Адрес: theme=light|dark, state=ready|empty|failed|loading. «failed»: первая загрузка падает, «Повторить» загружает.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const state = params.get("state") ?? "ready";

const NOW = Date.UTC(2026, 9, 13, 9);
const DAY = 24 * 60 * 60 * 1000;
const entry = (fieldId: string, value: unknown, daysAgo = 3): ClientCardEntry => ({
  fieldId,
  value,
  updatedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  chatId: "chat-1",
  flowId: "sales-review",
});

/** Поля сценария «Разбор»: порядок = что узнать раньше. */
const fields = [
  { id: "name", name: "Имя", refreshAfterMonths: null },
  { id: "course_topic", name: "Тема курса", refreshAfterMonths: null },
  { id: "sales", name: "Продажи курса", refreshAfterMonths: null },
  { id: "occupation", name: "Чем занимается", refreshAfterMonths: 12 },
  { id: "audience", name: "Аудитория", refreshAfterMonths: null },
  { id: "channels", name: "Откуда приходят люди", refreshAfterMonths: 6 },
];

const note = (id: string, categories: string[], content: string): MemoryNote => ({ id, categories, content, version: 1, createdAt: new Date(NOW - 20 * DAY).toISOString(), updatedAt: new Date(NOW - 20 * DAY).toISOString() });
const memoryNotes = [
  note("1", ["Предпочтения"], "Пишет коротко и без смайликов."),
  note("2", ["Предпочтения"], "Удобнее вечером, после 19:00."),
  note("3", ["Работа"], "Ведёт курс по акварели для новичков."),
];
const memoryApi: MemoryApi = {
  list: async () => ({ notes: memoryNotes, counts: { total: memoryNotes.length, limit: 200, shown: memoryNotes.length } }),
  create: async () => memoryNotes[0]!,
  update: async () => memoryNotes[0]!,
  remove: async () => undefined,
  clear: async () => 0,
  listMerges: async () => [],
  revertMerge: async () => undefined,
};

function Gallery() {
  const store = useMemo(() => {
    let entries: ClientCardEntry[] =
      state === "empty"
        ? []
        : [entry("channels", "Инстаграм", 220), entry("name", "Ольга"), entry("course_topic", "Акварель для новичков"), entry("sales", "до 10 продаж"), entry("occupation", "Иллюстратор", 430)];
    let failures = state === "failed" ? 1 : 0;
    return {
      read: async () => {
        if (state === "loading") return new Promise<ClientCardEntry[]>(() => undefined);
        if (failures > 0) {
          failures -= 1;
          throw new Error("нет связи");
        }
        return entries;
      },
      forget: async (fieldId: string) => {
        entries = fieldId === "all" ? [] : entries.filter((item) => item.fieldId !== fieldId);
      },
    };
  }, []);
  return (
    <div className="grid min-h-full items-start gap-6 bg-[var(--background)] p-4 min-[900px]:grid-cols-2" style={{ color: "var(--foreground)" }}>
      <AgentMemory api={memoryApi} skin={tandemMemorySkin} />
      <ClientCardPanel skin={tandemClientCardSkin} fields={fields} read={store.read} forget={store.forget} now={() => NOW} timeZone="UTC" />
    </div>
  );
}

// Без StrictMode: двойной запуск загрузки съел бы единственную «первую ошибку».
createRoot(document.getElementById("root")!).render(<Gallery />);
