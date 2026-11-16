import { ChatNotFoundError } from "@ykurilov/agent-chat-core";
import type { BackgroundPort } from "@ykurilov/agent-chat-core";
import { asSchema } from "ai";
import type { TaskRunner } from "./task-runner";
import type { BackgroundToolDefinition } from "./types";

/** Что приложение передаёт, чтобы само запустить фоновую задачу в чате (`start`). */
export interface StartTaskRequest {
  ownerId: string;
  chatId: string;
  /** Имя фонового инструмента из `tools` службы. */
  name: string;
  /** Вход инструмента; проверяется схемой инструмента так же, как вызов модели. */
  input: unknown;
  /** Название для карточки и служебного сообщения; нет — `title(input)` инструмента, пусто и там — имя инструмента. */
  title?: string;
}

export type StartTaskResult =
  | { status: "started"; taskId: string; title: string }
  /** Все места человека заняты (`maxRunningPerUser`): ничего не записано, запустить можно позже. */
  | { status: "too_many_tasks"; message: string };

const TOO_MANY_TASKS_FOR_APP = (max: number) =>
  `Слишком много фоновых задач: у человека одновременно идёт не больше ${max}. Задача не запущена: запустите её, когда одна из идущих закончится.`;

/**
 * Запуск фонового инструмента из кода приложения — тем же путём, что вызов модели: предел мест, аренда, карточка,
 * отмена, итог служебным сообщением. Отличие одно: задача помечена `startedBy: "app"`, и модель узнаёт из служебного
 * сообщения, что её запустило приложение.
 */
export async function startFromApp(
  request: StartTaskRequest,
  deps: { tools: Record<string, BackgroundToolDefinition>; port: BackgroundPort; runner: TaskRunner; maxRunningPerUser: number },
): Promise<StartTaskResult> {
  const { ownerId, chatId, name } = request;
  const definition = Object.hasOwn(deps.tools, name) ? deps.tools[name] : undefined;
  if (!definition) throw new TypeError(`Фоновые задачи: фонового инструмента «${name}» нет в настройках службы`);
  const input = await checkedInput(name, definition, request.input);
  await deps.port.assertOwnChat(ownerId, chatId);
  // Пустое название — «Фоновая задача "" закончилась»: тогда хотя бы имя инструмента.
  const title = request.title?.trim() || definition.title(input).trim() || name;

  const started = await deps.runner.start(
    { ownerId, chatId, messageId: "", toolCallId: "", channel: "web", kind: "tool", name, input, title, startedBy: "app" },
    deps.maxRunningPerUser,
  );
  if (started.status === "too_many_tasks") return { status: "too_many_tasks", message: TOO_MANY_TASKS_FOR_APP(deps.maxRunningPerUser) };

  // Чат могли удалить, пока задача записывалась: уборка удаления её уже не увидела — убираем сами.
  try {
    await deps.port.assertOwnChat(ownerId, chatId);
  } catch (error) {
    if (error instanceof ChatNotFoundError) await deps.runner.chatDeleted(ownerId, chatId);
    throw error;
  }
  return { status: "started", taskId: started.taskId, title };
}

/** Та же проверка, что SDK делает перед вызовом инструмента: схема без проверки (`jsonSchema` без `validate`) пропускает всё. */
async function checkedInput(name: string, definition: BackgroundToolDefinition, input: unknown): Promise<unknown> {
  const validate = asSchema(definition.inputSchema).validate;
  if (!validate) return input;
  const checked = await validate(input);
  if (!checked.success) throw new TypeError(`Фоновые задачи: вход для «${name}» не подходит под схему инструмента: ${checked.error.message}`);
  return checked.value;
}
