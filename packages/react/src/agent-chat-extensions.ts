import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentType } from "react";
import type { AppEventViews } from "./app-events";
import type { AgentVideoView, CustomWidgetProps, DiagramColors, GeneratedImagesView } from "./skin-contract";
import type { StepPhrases, WorkView } from "./work-view/step-phrases";

/** Рисовальщик схем (пакет `@ykurilov/agent-chat-diagrams`, `diagramsClient`): тот же договор, что в пакете схем. */
export interface DiagramsClient {
  render(source: string, colors: DiagramColors): Promise<{ svg: string } | { error: string }>;
}

/**
 * Картинки агента на экране (пакет `@ykurilov/agent-chat-images`, `imagesClient`): сообщает слою поведения имя инструмента
 * и превращает его вызов в вид для скина. Нет `describe`-результата — вызов остаётся обычной строкой инструмента.
 */
export interface ImagesClient {
  /** Имя инструмента, чьи вызовы рисуются как картинки: `generate_images`. */
  toolName: string;
  describe(call: {
    part: ToolUIPart | DynamicToolUIPart;
    api: string;
    chatId: string;
    /** Открыть картинку в окне просмотра; `key` — id вложения. */
    openImage: (key: string, trigger: HTMLElement) => void;
  }): GeneratedImagesView | undefined;
}

/**
 * Видео агента на экране (пакет `@ykurilov/agent-chat-videos`, `videosClient`): превращает вызов `show_video` в вид
 * карточки. `loading` — вызов идёт, ничего не показывать; `undefined` — отказ или ошибка, обычная строка инструмента.
 */
export interface VideosClient {
  /** Имя инструмента, чьи вызовы рисуются как видео: `show_video`. */
  toolName: string;
  describe(part: ToolUIPart | DynamicToolUIPart): { state: "loading" } | { state: "ready"; video: AgentVideoView } | undefined;
}

/** Свои виджеты страницы: имя инструмента → компонент. Типы входа и ответа у каждого свои, поэтому `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- компоненты разных виджетов лежат в одной таблице
export type CustomWidgets = Record<string, ComponentType<CustomWidgetProps<any, any>>>;

/**
 * Необязательные расширения чата, которые страница подключает свойствами `AgentChat`, `ChatWorkspace` и `AgentPanel`
 * и которые слой поведения несёт вниз до частей ответа. Без них отрисовка и запросы, как в 0.15.
 */
export interface AgentChatExtensions {
  /** Свои виджеты: `{ pick_slot: PickSlotWidget }`. Базовые виджеты свойства не требуют. */
  widgets?: CustomWidgets;
  /** Схемы из блоков ```mermaid: `diagramsClient`. */
  diagrams?: DiagramsClient;
  /**
   * Живые демонстрации из блоков ```html-demo (docs/live-demos.md): `true` — блок запускается в изолированной рамке.
   * На сервере — `agent.liveDemos: true`.
   */
  liveDemos?: boolean;
  /** Картинки агента: `imagesClient`. */
  images?: ImagesClient;
  /** Видео агента: `videosClient`. */
  videos?: VideosClient;
  /** Вид событий приложения в ответе: тип события → компонент (`{ lesson_passed: LessonPassedBadge }`). */
  appEvents?: AppEventViews;
  /**
   * Вид работы агента: `detailed` (по умолчанию) — мысли и строки инструментов, как раньше; `simple` — для новичков:
   * живая строка с текущим шагом, после хода «Сделано N шагов» со списком понятных фраз. Меняется на лету. Это
   * отображение, а не права: что прячется от человека, решают права чата (`toolDetails`, `reasoning`).
   */
  workView?: WorkView;
  /**
   * Понятные фразы шагов для простого вида: имя инструмента → фразы «идёт» и «готово» (готовые или функция от вызова).
   * Нет фразы — `title` инструмента, иначе общая из `labels.workView`. Таблицу держите постоянной.
   */
  stepPhrases?: StepPhrases;
}
