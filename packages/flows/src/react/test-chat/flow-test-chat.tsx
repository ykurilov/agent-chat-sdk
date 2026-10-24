import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FlowDayInfo } from "../../engine/flow-days";
import { stateById } from "../../engine/flow-graph";
import { parseDuration } from "../../format/parse-duration";
import { russianFlowTestChatLabels, type FlowTestChatLabels } from "../../labels/test-chat";
import { FlowEditor, type FlowEditorProps } from "../editor/flow-editor";
import { useFlowLabels } from "../flow-labels";
import { flowNoticeLines } from "../notice-lines";
import type { FlowEditorFrameProps, FlowEditorSkin, FlowHeaderProps, FlowStateNodeProps } from "../flow-editor-skin";
import { useFlowTestChat, type FlowTestChatConnection, type FlowTestChatController } from "./use-flow-test-chat";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Варианты перемотки по умолчанию: 20 минут, 3 часа, сутки. */
export const DEFAULT_ADVANCE_STEPS: readonly number[] = [20 * MINUTE, 3 * HOUR, DAY];

/** Длительность словами: «1 д 3 ч 20 мин». */
export function formatDuration(ms: number, units: FlowTestChatLabels["units"]): string {
  const minutes = Math.round(ms / MINUTE);
  const parts: Array<[number, string]> = [
    [Math.floor(minutes / (24 * 60)), units.day],
    [Math.floor(minutes / 60) % 24, units.hour],
    [minutes % 60, units.minute],
  ];
  return parts
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount} ${unit}`)
    .join(" ");
}

/** Сдвиг часов тестового чата готовой строкой: «как сейчас», «+3 ч 20 мин». */
export function formatClockOffset(ms: number, labels: FlowTestChatLabels = russianFlowTestChatLabels): string {
  const { noOffset, units } = labels;
  const text = formatDuration(ms, units);
  return text ? `+${text}` : noOffset;
}

/** Строка дня тестового чата: «День 2 из 3 · 14:20» по часам чата в поясе человека; дней нет — `null`. */
export function formatDayLine(day: FlowDayInfo | null | undefined, at: number, timeZone: string, labels: FlowTestChatLabels = russianFlowTestChatLabels): string | null {
  if (!day) return null;
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return `${day.day === 0 ? labels.beforeFirstDay : labels.day(day.day, day.totalDays)} · ${time}`;
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export interface FlowTestChatProps extends FlowEditorProps {
  testChat: FlowTestChatConnection;
  /** Варианты перемотки, мс. По умолчанию `DEFAULT_ADVANCE_STEPS`. */
  advanceSteps?: readonly number[];
}

interface TestChatView {
  controller: FlowTestChatController;
  /** Рамка тестового чата вместо панели редактора; `null` — тестовый чат закрыт. */
  panel: ReactNode | null;
}

const TestChatContext = createContext<TestChatView | null>(null);

function useTestChatView(): TestChatView {
  const view = useContext(TestChatContext);
  if (!view) throw new Error("Test chat parts render only inside FlowTestChat.");
  return view;
}

/**
 * Скин редактора с тестовым чатом поверх скина приложения: в шапке кнопка теста, справа вместо панели — чат, на доске
 * подсвечено место чата. Обёртки постоянные на скин: доска не пересоздаёт узлы.
 */
function withTestChat(skin: FlowEditorSkin): FlowEditorSkin {
  function Header(props: FlowHeaderProps) {
    const { controller } = useTestChatView();
    const openAnyState = props.onOpenAnyState;
    return <skin.FlowHeader {...props} onOpenTestChat={controller.open}
      {...(openAnyState ? { onOpenAnyState: () => { controller.close(); openAnyState(); } } : {})}
    />;
  }
  function Frame(props: FlowEditorFrameProps) {
    const { panel } = useTestChatView();
    return <skin.FlowEditorFrame {...props} panel={panel ?? props.panel} />;
  }
  function StateNode(props: FlowStateNodeProps) {
    const { controller } = useTestChatView();
    if (!controller.opened || controller.stateId === null) return <skin.FlowStateNode {...props} />;
    const run = controller.stateId === props.stateId ? "current" : controller.visited.has(props.stateId) ? "visited" : null;
    return <skin.FlowStateNode {...props} run={run} dimmed={false} />;
  }
  return { ...skin, FlowHeader: Header, FlowEditorFrame: Frame, FlowStateNode: StateNode };
}

/**
 * Редактор сценария с тестовым чатом: автор пишет агенту рядом с доской, видит текущее состояние и перематывает часы
 * чата, чтобы проверить таймеры без ожидания. Сервер и экран чата даёт приложение (`testChat`).
 */
export function FlowTestChat({ testChat, advanceSteps = DEFAULT_ADVANCE_STEPS, skin, ...editor }: FlowTestChatProps) {
  const { testChat: labels, notices } = useFlowLabels();
  const noticeLines = useMemo(() => flowNoticeLines(notices), [notices]);
  const controller = useFlowTestChat(testChat, editor.value);
  const testSkin = useMemo(() => withTestChat(skin), [skin]);

  const state = controller.stateId === null ? undefined : stateById(editor.value, controller.stateId);
  const panel = controller.opened ? (
    <skin.FlowTestChatFrame
      stateTitle={state?.title || controller.stateId || ""}
      clock={formatClockOffset(controller.timeOffset, labels)}
      advanceSteps={advanceSteps.map((ms) => ({ label: formatDuration(ms, labels.units), ms }))}
      onAdvance={controller.advance}
      day={formatDayLine(controller.day, (editor.now?.() ?? Date.now()) + controller.timeOffset, editor.timeZone ?? browserTimeZone(), labels)}
      {...(controller.nextDay && editor.value.schedule ? { onNextDay: controller.nextDay } : {})}
      {...(controller.nextFirstMessage && { onNextFirstMessage: controller.nextFirstMessage, nothingScheduled: controller.nothingScheduled })}
      onAdvanceText={(text) => {
        const ms = parseDuration(text);
        if (ms !== undefined) controller.advance(ms);
        return ms !== undefined;
      }}
      busy={controller.busy}
      failed={controller.failed}
      onReset={controller.reset}
      onClose={controller.close}
    >
      {controller.chatId === null ? null : testChat.renderChat(controller.chatId, { noticeLines })}
    </skin.FlowTestChatFrame>
  ) : null;

  return (
    <TestChatContext.Provider value={{ controller, panel }}>
      <FlowEditor skin={testSkin} {...editor} />
    </TestChatContext.Provider>
  );
}
