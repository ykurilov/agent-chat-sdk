import { AsyncLocalStorage } from "node:async_hooks";
import type { LanguageModelV4Middleware } from "@ai-sdk/provider";
import type { BeforeTurnHandler, ModelCatalog } from "@ykurilov/agent-chat-core";
import { APICallError, wrapLanguageModel } from "ai";

/*
 * Имитация сбоев провайдера для стенда (сценарии 10–11 quickstart). В модуль не входит:
 * демо оборачивает модели своего каталога, и они отвечают так, как ответил бы провайдер при сбое.
 */

/**
 * `overloaded-first` — перегружен только первый провайдер модели: ход отвечает через запасного.
 * `conversation-closed` — сбой не провайдера, а обёртки приложения: она отказывает каждому ходу 409 со своим текстом.
 * `lesson-closed` — приложение отказывает ходу через `beforeTurn`: код `demo_closed`, текст «Урок закрыт».
 */
export const demoFailures = ["overloaded", "overloaded-first", "invalid-key", "conversation-closed", "lesson-closed"] as const;
export type DemoFailure = (typeof demoFailures)[number];
/** Сбои провайдера: их отвечают модели каталога. */
type ProviderFailure = Exclude<DemoFailure, "conversation-closed" | "lesson-closed">;

export function parseDemoFailure(value: string | undefined): DemoFailure | null {
  return demoFailures.find((known) => known === value) ?? null;
}

const TURN_ENDPOINTS = ["/messages", "/retry", "/regenerate", "/edit"];

/** Отказ обёртки приложения ходу (`conversation-closed`): 409 `{ error: "Разговор завершён" }`; `null` — отказа нет. */
export function demoTurnRefusal(failure: DemoFailure | null, request: Request): Response | null {
  if (failure !== "conversation-closed" || request.method !== "POST") return null;
  const path = new URL(request.url).pathname;
  return TURN_ENDPOINTS.some((endpoint) => path.endsWith(endpoint)) ? Response.json({ error: "Разговор завершён" }, { status: 409 }) : null;
}

/** Сбой, выбранный в запросе, который запустил ход. */
const currentFailure = new AsyncLocalStorage<DemoFailure | null>();

/** Выполняет обработку запроса с выбранным сбоем: ход агента, начатый в ней, его унаследует. */
export function withDemoFailure<T>(failure: DemoFailure | null, run: () => T): T {
  return currentFailure.run(failure, run);
}

/** Проверка приложения перед ходом: при выбранном «Уроке закрыт» не пускает никакой ход, остальным режимам не мешает. */
export const demoBeforeTurn: BeforeTurnHandler = () =>
  currentFailure.getStore() === "lesson-closed" ? { code: "demo_closed", message: "Урок закрыт" } : undefined;

function simulatedError(failure: ProviderFailure): APICallError {
  const overloaded = failure !== "invalid-key";
  return new APICallError({
    message: overloaded ? "Simulated overload" : "Simulated invalid API key",
    url: "https://demo.invalid/simulated-failure",
    requestBodyValues: {},
    statusCode: overloaded ? 503 : 401,
    responseBody: JSON.stringify({ error: { message: overloaded ? "Simulated overload" : "Simulated invalid key" } }),
    isRetryable: overloaded,
  });
}

/** Сбой для запроса к модели; `isFirstProvider` — провайдер первый в профиле модели. */
function failureFor(isFirstProvider: boolean): ProviderFailure | null {
  const selected = currentFailure.getStore() ?? null;
  const failure = selected === "conversation-closed" || selected === "lesson-closed" ? null : selected;
  return failure === "overloaded-first" && !isFirstProvider ? null : failure;
}

function failureMiddleware(isFirstProvider: boolean): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      const failure = failureFor(isFirstProvider);
      if (failure) throw simulatedError(failure);
      return doStream();
    },
    wrapGenerate: async ({ doGenerate }) => {
      const failure = failureFor(isFirstProvider);
      if (failure) throw simulatedError(failure);
      return doGenerate();
    },
  };
}

/** Тот же каталог, но каждый запрос к модели сначала проверяет, не выбран ли сбой. */
export function withFailureSimulation(catalog: ModelCatalog): ModelCatalog {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      createLanguageModel: (...args: Parameters<typeof provider.createLanguageModel>) => {
        const model = provider.createLanguageModel(...args);
        const [providerModelId] = args;
        const profile = catalog.models.find((candidate) => candidate.providerModelIds[provider.id] === providerModelId);
        const isFirstProvider = profile !== undefined && Object.keys(profile.providerModelIds)[0] === provider.id;
        return typeof model === "string" ? model : wrapLanguageModel({ model, middleware: failureMiddleware(isFirstProvider) });
      },
    })),
  };
}
