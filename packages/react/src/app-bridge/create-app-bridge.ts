import type { AgentAppBridge, AppDataChange, BrowserToolFunction, ScreenPlace } from "./app-bridge";
import { rememberedIds } from "./remembered-ids";
import { readTabId } from "./tab-id";

/** Что мост берёт у приложения; читается в момент вызова, поэтому новые свойства провайдера видны без нового моста. */
export interface AppBridgeOptions {
  /** Функции браузерных инструментов по именам. */
  browserTools?: Record<string, BrowserToolFunction>;
  /** Получает каждое сообщение об изменении данных, любой метки. */
  onDataChanged?: (change: AppDataChange) => void;
  /** Ответ модели, если функции инструмента на этой странице нет. */
  toolUnavailableMessage: string;
}

/** Владелец места: чем больше `order`, тем позже создан и тем главнее его место. */
export interface PlaceOwner {
  readonly order: number;
}

/** Мост и то, чем его наполняют хуки панели: места компонентов и подписки на изменения данных. */
export interface AppBridgeControl {
  bridge: AgentAppBridge;
  /**
   * Владелец места для одного компонента; создаётся при его первой отрисовке. Владелец, созданный позже, главнее:
   * вложенный компонент рисуется после внешнего, поэтому страница всегда главнее макета, в котором стоит.
   */
  createPlaceOwner(): PlaceOwner;
  /** Место компонента `owner`; смена места не меняет, чьё главнее. `null` — снять своё место. */
  setPlace(owner: PlaceOwner, place: ScreenPlace | null): void;
  /** Снимает только место `owner`; места других компонентов остаются. */
  removePlace(owner: PlaceOwner): void;
  /** Подписка на сообщения с одной из меток `tags`; возвращает отписку. */
  subscribe(tags: readonly string[], handler: (change: AppDataChange) => void): () => void;
}

/**
 * Под этим ключом `sessionStorage` хранит `id` розданных сообщений (последние 500): повтор кусков ответа, в том числе
 * после перезагрузки страницы во время ответа, не раздаёт сообщение второй раз.
 */
export const APP_CHANGES_DELIVERED_KEY = "agent-chat:app-changes-delivered";

const deliveredChanges = rememberedIds(APP_CHANGES_DELIVERED_KEY, 500);

export function createAppBridge(readOptions: () => AppBridgeOptions): AppBridgeControl {
  /** Заданные места; текущее — у владельца с наибольшим `order`. */
  const places = new Map<PlaceOwner, ScreenPlace>();
  let ownersCreated = 0;
  const subscriptions = new Set<{ tags: readonly string[]; handler: (change: AppDataChange) => void }>();

  const currentPlace = () => {
    let current: { owner: PlaceOwner; place: ScreenPlace } | null = null;
    for (const [owner, place] of places) if (current === null || owner.order > current.owner.order) current = { owner, place };
    return current?.place ?? null;
  };

  const bridge: AgentAppBridge = {
    tabId: readTabId(),
    currentPlace,
    dataChanged(change) {
      if (!deliveredChanges.claim(change.id)) return;
      const { onDataChanged } = readOptions();
      if (onDataChanged) deliver(() => onDataChanged(change));
      for (const subscription of [...subscriptions]) {
        if (subscription.tags.includes(change.tag)) deliver(() => subscription.handler(change));
      }
    },
    async browserCall(call, options) {
      const { browserTools, toolUnavailableMessage } = readOptions();
      const run = browserTools && Object.hasOwn(browserTools, call.toolName) ? browserTools[call.toolName] : undefined;
      if (!run) return { error: toolUnavailableMessage };
      try {
        const output = await run(call.input, { signal: options?.signal ?? new AbortController().signal });
        return { output };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  return {
    bridge,
    createPlaceOwner: () => ({ order: ++ownersCreated }),
    setPlace(owner, place) {
      if (place === null) places.delete(owner);
      else places.set(owner, place);
    },
    removePlace: (owner) => void places.delete(owner),
    subscribe(tags, handler) {
      const subscription = { tags, handler };
      subscriptions.add(subscription);
      return () => void subscriptions.delete(subscription);
    },
  };
}

/** Ошибка одного подписчика не мешает остальным и не обрывает поток ответа; она уходит в журнал страницы. */
function deliver(notify: () => void) {
  try {
    notify();
  } catch (error) {
    if (typeof globalThis.reportError === "function") globalThis.reportError(error);
    else console.error(error);
  }
}
