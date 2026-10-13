import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatModelChoice } from "./chat-types";
import { useChatLabels } from "./labels";
import type { ModelChoiceView } from "./skin-contract";

/** Список для меню, как его отдаёт `GET {api}/models`. */
interface ModelMenu {
  providers: Array<{
    id: string;
    displayName: string;
    models: Array<{ id: string; displayName: string; acceptsImages?: boolean; reasoning: { levels: string[]; defaultLevel: string | null } }>;
  }>;
  defaultChoice: {
    modelId: string;
    providerId: string;
    reasoning: string | null;
    /** Есть, когда выбор по умолчанию у скрытого провайдера: его нет в `providers`, но показать текущую модель надо. */
    details?: {
      providerName: string;
      modelName: string;
      acceptsImages?: boolean;
      reasoning: { levels: string[]; defaultLevel: string | null };
    };
  };
}

export interface UseModelChoiceOptions {
  /** Адрес обработчика чата, например `/api/chat`. */
  api: string;
  chatId: string;
  /** Выбор, сохранённый в чате (из истории). Пока его нет, показывается выбор по умолчанию. */
  savedChoice?: ChatModelChoice | null;
  /**
   * История чата ещё грузится, и выбор чата не пришёл. Пока это так, выбор по умолчанию не показывается: у нового чата
   * выбор человека уже запомнен на сервере, и показ выбора по умолчанию мигнул бы чужой моделью.
   */
  savedChoicePending?: boolean;
  /**
   * Нужно ли меню. `false` — меню не запрашивается: права ещё не пришли с историей или модель скрыта
   * (`modelDetails: false`). По умолчанию `true`.
   */
  menuWanted?: boolean;
  /** Свой `fetch` — для тестов и особых сред. */
  fetch?: typeof globalThis.fetch;
  /**
   * Человек выбрал модель или уровень в меню, и сервер сохранил выбор: получает его, как он сохранён. Выбор по
   * умолчанию, выбор из истории и отказ сервера его не зовут.
   */
  onModelChosen?: (choice: ChatModelChoice) => void;
}

type MenuState = { status: "loading" } | { status: "ready"; menu: ModelMenu } | { status: "failed" };

const unavailable: ModelChoiceView["current"] = { providerId: "", modelId: "" };

/**
 * Выбор модели и уровня рассуждений для поля ввода. Живёт отдельно от `useAgentChat`, чтобы смена выбора
 * не перерисовывала ленту. Смена видна сразу; при отказе сервера выбор откатывается к последнему сохранённому.
 */
export function useModelChoice({ api, chatId, savedChoice, savedChoicePending = false, menuWanted = true, fetch: customFetch, onModelChosen }: UseModelChoiceOptions): ModelChoiceView {
  const labels = useChatLabels();
  // Новая функция `fetch` при перерисовке страницы не перечитывает меню: запросы берут последнюю.
  const fetchRef = useRef(customFetch);
  fetchRef.current = customFetch;
  const request = useCallback<typeof globalThis.fetch>((input, init) => (fetchRef.current ?? globalThis.fetch)(input, init), []);
  const reportChosen = useRef(onModelChosen);
  reportChosen.current = onModelChosen;
  const [menuState, setMenuState] = useState<MenuState>({ status: "loading" });
  /** Выбор, сделанный в этой вкладке и ещё не заменённый историей чата. */
  const [override, setOverride] = useState<ChatModelChoice | null>(null);
  const [failed, setFailed] = useState(false);
  /** Последний выбор, подтверждённый сервером; к нему откатывается неудачная смена. */
  const confirmed = useRef<ChatModelChoice | null>(null);
  const latestRequest = useRef(0);

  /** Адрес, меню которого уже получено (или не получено окончательно): смена чата его не перечитывает. */
  const menuOf = useRef<string | null>(null);
  useEffect(() => {
    if (!menuWanted || menuOf.current === api) return;
    let cancelled = false;
    setMenuState({ status: "loading" });
    void (async () => {
      try {
        const response = await request(`${api}/models`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const menu = (await response.json()) as ModelMenu;
        if (cancelled) return;
        menuOf.current = api;
        setMenuState({ status: "ready", menu });
      } catch {
        if (cancelled) return;
        menuOf.current = api;
        setMenuState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, request, menuWanted]);

  useEffect(() => {
    latestRequest.current++;
    confirmed.current = null;
    setOverride(null);
    setFailed(false);
  }, [chatId, savedChoice?.modelId, savedChoice?.providerId, savedChoice?.reasoning]);

  const menu = menuState.status === "ready" ? menuState.menu : null;
  const waitingForSavedChoice = savedChoicePending && !override && !savedChoice;
  const effective = useMemo(
    () => (menu && !waitingForSavedChoice ? effectiveChoice(menu, override ?? savedChoice ?? null) : null),
    [menu, override, savedChoice, waitingForSavedChoice],
  );

  const save = useCallback(
    async (next: ChatModelChoice) => {
      const requestNumber = ++latestRequest.current;
      setFailed(false);
      setOverride(next);
      let saved: ChatModelChoice;
      try {
        const response = await request(`${api}/${encodeURIComponent(chatId)}/model`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        saved = (await response.json()) as ChatModelChoice;
        confirmed.current = saved;
        if (requestNumber === latestRequest.current) setOverride(saved);
      } catch {
        if (requestNumber !== latestRequest.current) return;
        setOverride(confirmed.current);
        setFailed(true);
        return;
      }
      // Выбор уже сохранён: сбой колбэка приложения его не откатывает.
      try {
        reportChosen.current?.(saved);
      } catch (error) {
        console.error(error);
      }
    },
    [api, chatId, request],
  );

  const onChange = useCallback<ModelChoiceView["onChange"]>(
    ({ providerId, modelId }) => {
      if (!menu || !effective) return;
      const model = findModel(menu, providerId, modelId);
      if (!model) return;
      const { levels, defaultLevel } = model.reasoning;
      const kept = effective.reasoning && levels.includes(effective.reasoning) ? effective.reasoning : defaultLevel;
      void save({ providerId, modelId, ...(kept && { reasoning: kept }) });
    },
    [effective, menu, save],
  );

  const onReasoningChange = useCallback(
    (levelId: string) => {
      if (effective) void save({ providerId: effective.providerId, modelId: effective.modelId, reasoning: levelId });
    },
    [effective, save],
  );

  return useMemo<ModelChoiceView>(() => {
    const error = failed ? labels.modelChoiceFailed : menuState.status === "failed" ? labels.modelMenuFailed : undefined;
    if (!menu || !effective) {
      return { providers: [], current: unavailable, onChange, reasoningLevels: [], reasoning: "", onReasoningChange, ...(error && { error }) };
    }
    const levels = knownModel(menu, effective.providerId, effective.modelId)?.reasoning.levels ?? [];
    return {
      providers: [
        ...menu.providers.map((provider) => ({
          id: provider.id,
          name: provider.displayName,
          models: provider.models.map((model) => ({
            id: model.id,
            name: model.displayName,
            ...(typeof model.acceptsImages === "boolean" && { acceptsImages: model.acceptsImages }),
          })),
        })),
        ...hiddenCurrent(menu, effective),
      ],
      current: { providerId: effective.providerId, modelId: effective.modelId },
      onChange,
      reasoningLevels: levels.map((id) => ({ id, name: labels.reasoningLevels[id as keyof typeof labels.reasoningLevels] ?? id })),
      reasoning: effective.reasoning ?? "",
      onReasoningChange,
      ...(error && { error }),
    };
  }, [effective, failed, labels, menu, menuState.status, onChange, onReasoningChange]);
}

function findModel(menu: ModelMenu, providerId: string, modelId: string) {
  return menu.providers.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId);
}

/** Модель из меню или, если текущий выбор — выбор по умолчанию скрытого провайдера, модель по его `details`. */
function knownModel(menu: ModelMenu, providerId: string, modelId: string) {
  const listed = findModel(menu, providerId, modelId);
  if (listed) return listed;
  const { defaultChoice } = menu;
  if (defaultChoice.providerId !== providerId || defaultChoice.modelId !== modelId) return undefined;
  const { details } = defaultChoice;
  return details && { id: modelId, displayName: details.modelName, acceptsImages: details.acceptsImages, reasoning: details.reasoning };
}

/**
 * Текущий выбор, которого нет в меню (выбор по умолчанию скрытого провайдера), показывается в списке своим пунктом, чтобы
 * поле не было пустым. Выбрать его вручную нельзя: `onChange` смотрит только в меню.
 */
function hiddenCurrent(menu: ModelMenu, current: ChatModelChoice): ModelChoiceView["providers"] {
  if (findModel(menu, current.providerId, current.modelId)) return [];
  const model = knownModel(menu, current.providerId, current.modelId);
  const { details } = menu.defaultChoice;
  return [
    {
      id: current.providerId,
      name: details?.providerName ?? current.providerId,
      models: [
        {
          id: current.modelId,
          name: model?.displayName ?? current.modelId,
          ...(typeof model?.acceptsImages === "boolean" && { acceptsImages: model.acceptsImages }),
        },
      ],
    },
  ];
}

/** Выбор для показа: заданный, если он есть в меню, иначе выбор по умолчанию; уровень — из уровней модели. */
function effectiveChoice(menu: ModelMenu, wanted: ChatModelChoice | null): ChatModelChoice {
  const candidate = wanted && findModel(menu, wanted.providerId, wanted.modelId) ? wanted : fromDefault(menu);
  const model = knownModel(menu, candidate.providerId, candidate.modelId);
  const { levels, defaultLevel } = model?.reasoning ?? { levels: [], defaultLevel: null };
  const reasoning = candidate.reasoning && levels.includes(candidate.reasoning) ? candidate.reasoning : defaultLevel;
  return { providerId: candidate.providerId, modelId: candidate.modelId, ...(reasoning && { reasoning }) };
}

function fromDefault(menu: ModelMenu): ChatModelChoice {
  const { modelId, providerId, reasoning } = menu.defaultChoice;
  return { modelId, providerId, ...(reasoning && { reasoning }) };
}
