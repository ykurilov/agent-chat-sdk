import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import type { ChatHandlerOptions } from "@ykurilov/agent-chat-server";
import { realOwnerOf } from "./sandbox-owner";
import { withRealOwner } from "./sandbox-tools";

type ChatMemory = NonNullable<ChatHandlerOptions["memory"]>;
type ToolSet = ReturnType<ChatMemory["tools"]>;

const READ_ONLY_MESSAGE = "в песочнице память только для чтения";
const refusal = { kind: "invalid" as const, message: READ_ONLY_MESSAGE };

/** Чья память у хода: по умолчанию — настоящего id админа за песочным владельцем. */
export interface MemoryOwner {
  /** Модель хода для инструментов памяти (с нужным `ownerId`). */
  toolsModel(model: AgentToolsModel): AgentToolsModel;
  /** Человек, чья память у чата; нет — память админа. */
  personOf(chatId: string): string | undefined;
}

const adminMemory: MemoryOwner = { toolsModel: withRealOwner, personOf: () => undefined };

/**
 * Боевая память только на чтение: админа, а в копии чата человека — этого человека (`owner`). Блок памяти и
 * инструменты — с этим id; у инструментов те же имя, описание и схема (начало запроса кэшируется так же), но всё,
 * кроме `search`, отвечает агенту отказом. Оптимизации после ответа (`afterAnswer`) нет; адреса экрана памяти
 * песочница закрывает сама.
 */
export function readOnlyMemory(memory: ChatMemory, owner: MemoryOwner = adminMemory): ChatMemory {
  return {
    instructions: memory.instructions,
    toolNames: memory.toolNames,
    tools: (model) => readOnlyTools(memory.tools(owner.toolsModel(model))),
    snapshot: (input) => memory.snapshot({ ...input, userId: owner.personOf(input.chatId) ?? realOwnerOf(input.userId) }),
    ...(memory.blocks && {
      blocks: (input: Parameters<NonNullable<ChatMemory["blocks"]>>[0]) => memory.blocks!({ ...input, userId: owner.personOf(input.chatId) ?? realOwnerOf(input.userId) }),
    }),
    list: (ownerId) => memory.list(realOwnerOf(ownerId)),
    create: async () => ({ ok: false, error: refusal }),
    update: async () => ({ ok: false, error: refusal }),
    remove: async () => ({ ok: false, error: refusal }),
    clear: async () => 0,
  };
}

function readOnlyTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;
      if (!execute) return [name, tool];
      return [name, { ...tool, execute: (input: unknown, options: unknown) => (isSearch(input) ? execute(input, options as never) : { error: refusal }) }];
    }),
  ) as ToolSet;
}

function isSearch(input: unknown): boolean {
  return typeof input === "object" && input !== null && (input as { action?: unknown }).action === "search";
}
