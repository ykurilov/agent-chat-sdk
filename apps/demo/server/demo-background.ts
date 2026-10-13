import { tool } from "ai";
import { z } from "zod";
import { backgroundTool } from "@ykurilov/agent-chat-background";
import type { BackgroundToolDefinition } from "@ykurilov/agent-chat-background";
import type { AgentHelper } from "@ykurilov/agent-chat-core";

/*
 * Помощники и фон демо.
 * Помощник «исследователь» ищет по поддельному поиску и отвечает коротко: ход его работы человек видит в строке вызова.
 * Фоновый инструмент «отчёт» заканчивается не по времени, а по условию: пока кто-то не «выпустит» отчёт по его теме,
 * задача идёт. В приложении это делает кнопка или другая система, в e2e — адрес `/api/demo/reports/release`.
 * Так тесты не ждут пауз и не зависят от скорости машины.
 */

/** Тема вопроса: из задания помощнику «Изучи тему: …». */
const researchTaskPattern = /^Изучи тему:\s*(.+)$/s;
export const researchTaskPrefix = "Изучи тему: ";
export const researchTaskTopic = (task: string) => researchTaskPattern.exec(task.trim())?.[1]?.trim();

/** Поддельный поиск: по теме отдаёт три источника, без сети. */
export function fakeSearchResult(query: string): string {
  return `Источники по теме «${query}»: учебник, статья, обзор.`;
}

const searchSources = tool({
  description: "Ищет источники по теме.",
  inputSchema: z.object({ query: z.string().min(1).describe("Тема поиска") }),
  execute: async ({ query }) => fakeSearchResult(query),
});

export const researcherHelper: AgentHelper = {
  description: "Изучает тему по источникам и коротко докладывает, что нашёл. Зови, когда нужно разобраться в теме.",
  instructions: "Ты исследователь. Найди источники по теме из задания и коротко доложи, что нашёл.",
  model: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
  tools: { search_sources: searchSources },
  maxSteps: 4,
};

/** Условие «отчёт готов» по темам: выпущенный заранее отчёт не ждёт никого. */
interface ReportGate {
  released: boolean;
  waiting: Set<() => void>;
}

export function createDemoReports() {
  const gates = new Map<string, ReportGate>();
  const gateOf = (topic: string) => {
    let gate = gates.get(topic);
    if (!gate) gates.set(topic, (gate = { released: false, waiting: new Set() }));
    return gate;
  };

  /** Ждёт, пока отчёт по теме выпустят; отмена задачи снимает ожидание. */
  function untilReleased(topic: string, signal: AbortSignal): Promise<void> {
    const gate = gateOf(topic);
    if (gate.released || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        gate.waiting.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      gate.waiting.add(done);
      signal.addEventListener("abort", done);
    });
  }

  const report: BackgroundToolDefinition = backgroundTool({
    description: "Готовит отчёт по теме. Долгая работа: идёт в фоне, итог придёт сообщением. Зови, когда человек просит отчёт.",
    inputSchema: z.object({ topic: z.string().min(1).describe("Тема отчёта") }),
    title: ({ topic }: { topic: string }) => `Отчёт: ${topic}`,
    // После перезапуска сервера отчёт собирается заново и ждёт выпуска так же, как до него.
    rerunAfterRestart: true,
    run: async ({ topic }: { topic: string }, { signal, reportProgress }) => {
      reportProgress("Собираю данные");
      await untilReleased(topic, signal);
      if (signal.aborted) throw new Error("Отчёт остановлен");
      return `Отчёт «${topic}» готов: три раздела, шесть таблиц.`;
    },
  });

  return {
    tools: { report },
    /** Выпускает отчёт по теме: задача, которая его ждёт, заканчивается. */
    release(topic: string) {
      const gate = gateOf(topic);
      gate.released = true;
      for (const wake of [...gate.waiting]) wake();
    },
  };
}
