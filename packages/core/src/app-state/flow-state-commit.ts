/** @internal Серверный порт расширения flows. Не инструмент и не HTTP-метод. Пишет только ключ flow. */
export interface FlowStateCommitInput {
  ownerId: string;
  chatId: string;
  flowId: string;
  revision: string;
  expectedAtMessageId: string | null;
  /** Повтор операции на той же ветке ничего не дописывает. Другой payload с тем же ключом — ошибка. */
  idempotencyKey: string;
  flow: Record<string, unknown>;
}

export type FlowStateCommitResult =
  | { status: "applied" | "same"; atMessageId: string }
  | { status: "stale" | "busy" | "not_found" };

export type FlowStateCommit = (input: FlowStateCommitInput) => Promise<FlowStateCommitResult>;

const ports = new WeakMap<object, FlowStateCommit>();

/** @internal Регистрируется только ядром; данные из запроса человека сюда не маршрутизируются. */
export function registerFlowStateCommit(service: object, commit: FlowStateCommit): void {
  ports.set(service, commit);
}

/** @internal Порт живой службы для flows; у пользовательских адаптеров без capability — undefined. */
export function flowStateCommitter(service: object): FlowStateCommit | undefined {
  return ports.get(service);
}
