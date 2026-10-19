import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FlowDayInfo } from "../../engine/flow-days";
import type { FlowRun } from "../../engine/flow-run";
import type { AgentFlow } from "../../format/flow-format";
import type { FlowNoticeLines } from "../notice-lines";

/** Как часто тестовый чат перечитывает место, пока открыт, мс. */
const RUN_POLL_MS = 1000;

/** Что тестовому чату нужно от приложения: сервер и экран чата. Редактор не знает, где сервер. */
export interface FlowTestChatConnection {
  /** Новый тестовый чат по сценарию из редактора: сервер создаёт его с `flowTestChatData()`. */
  start(flow: AgentFlow): Promise<{ chatId: string }>;
  /** Промотать часы чата: на сервере `flow.advanceTestClock`. */
  advance(chatId: string, ms: number): Promise<{ timeOffset: number }>;
  /**
   * Промотать часы к началу следующего дня сценария: на сервере `flow.advanceTestClock({ chatId, to: "next_day_start" })`.
   * Нет — кнопки «К началу следующего дня» нет.
   */
  advanceToNextDay?(chatId: string): Promise<{ timeOffset: number }>;
  /**
   * Промотать часы ровно к моменту, когда сценарий сам напишет первым: на сервере
   * `flow.advanceTestClock({ chatId, to: "next_first_message" })`. Впереди ничего — ошибка с `code: "nothing_scheduled"`
   * (у `FlowTestClockError`; через сеть передайте код). Нет — кнопки «К следующему напоминанию» нет.
   */
  advanceToNextFirstMessage?(chatId: string): Promise<{ timeOffset: number }>;
  /** Место чата: на сервере `flow.readRun`. В браузер посетителя место не уходит, доска читает его отдельно. */
  readRun(chatId: string): Promise<(Pick<FlowRun, "state" | "path"> & { day?: FlowDayInfo }) | null>;
  /**
   * Экран чата приложения: `<AgentChat api=… chatId={chatId} skin=… noticeLines={options.noticeLines} />`.
   * `options.noticeLines` (с 0.65) — строки «Агент написал первым — человек молчал 1 ч 7 мин»: в тестовом чате они
   * включены по умолчанию. Видны, если сервер дал тестовым чатам право `appNotices`.
   */
  renderChat(chatId: string, options: { noticeLines: FlowNoticeLines }): ReactNode;
}

export interface FlowTestChatController {
  opened: boolean;
  chatId: string | null;
  /** Сдвиг часов чата, мс. */
  timeOffset: number;
  busy: boolean;
  failed: boolean;
  /** Где чат на доске; пока ходов нет — старт сценария. */
  stateId: string | null;
  /** Пройденные состояния, без текущего. */
  visited: ReadonlySet<string>;
  /** День сценария чата; `null` — у сценария нет «Дней и времени» или ходов ещё не было. */
  day: FlowDayInfo | null;
  open(): void;
  close(): void;
  reset(): void;
  advance(ms: number): void;
  /** К началу следующего дня сценария; `null` — приложение не дало `advanceToNextDay`. */
  nextDay: (() => void) | null;
  /** К следующему сообщению сценария; `null` — приложение не дало `advanceToNextFirstMessage`. */
  nextFirstMessage: (() => void) | null;
  /** Последняя перемотка к напоминанию: впереди сценарий сам ничего не напишет. */
  nothingScheduled: boolean;
}

type BoardRun = { state: string; visited: ReadonlySet<string>; day: FlowDayInfo | null };

/** Место чата с сервера: только то, что нужно доске. */
function runOf(run: Awaited<ReturnType<FlowTestChatConnection["readRun"]>>): BoardRun | null {
  if (!run || typeof run.state !== "string") return null;
  const visited = new Set((run.path ?? []).flatMap((step) => (typeof step.state === "string" && step.state !== run.state ? [step.state] : [])));
  return { state: run.state, visited, day: run.day ?? null };
}

const sameDay = (left: FlowDayInfo | null, right: FlowDayInfo | null) =>
  left === right || (left !== null && right !== null && left.day === right.day && left.totalDays === right.totalDays && left.dayStartedAt === right.dayStartedAt);

const sameRun = (left: BoardRun | null, right: BoardRun | null) =>
  left === right || (left !== null && right !== null && left.state === right.state && sameDay(left.day, right.day) && left.visited.size === right.visited.size && [...left.visited].every((id) => right.visited.has(id)));

const NOTHING_VISITED: ReadonlySet<string> = new Set();

/** Логика тестового чата редактора: открыть, перемотать, начать заново, подсветка состояния. */
export function useFlowTestChat(connection: FlowTestChatConnection, flow: AgentFlow): FlowTestChatController {
  const [opened, setOpened] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [timeOffset, setTimeOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [nothingScheduled, setNothingScheduled] = useState(false);
  const [run, setRun] = useState<BoardRun | null>(null);
  const latest = useRef({ connection, flow, chatId });
  latest.current = { connection, flow, chatId };

  const refresh = useCallback(async (id: string) => {
    try {
      const next = runOf(await latest.current.connection.readRun(id));
      if (latest.current.chatId === id) setRun((current) => (sameRun(current, next) ? current : next));
    } catch (error) {
      console.error("[flow] test chat: run not read", error);
    }
  }, []);

  // Пока панель открыта, место перечитывается: ходы чата и таймеры двигают его на сервере.
  useEffect(() => {
    if (!opened || chatId === null) return;
    void refresh(chatId);
    const timer = setInterval(() => void refresh(chatId), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [opened, chatId, refresh]);

  const work = useCallback(async (job: () => Promise<void>) => {
    setBusy(true);
    setFailed(false);
    setNothingScheduled(false);
    try {
      await job();
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "nothing_scheduled") {
        setNothingScheduled(true);
        return;
      }
      console.error("[flow] test chat:", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    () =>
      work(async () => {
        const { chatId: next } = await latest.current.connection.start(latest.current.flow);
        setRun(null);
        setChatId(next);
        setTimeOffset(0);
      }),
    [work],
  );

  /** Перемотка часов чата: сервер сдвигает часы и ждёт ход, который она вызвала; место перечитывается сразу. */
  const shift = (move: (chatId: string) => Promise<{ timeOffset: number }>) => {
    const current = latest.current.chatId;
    if (current === null) return;
    void work(async () => {
      const { timeOffset: next } = await move(current);
      setTimeOffset(next);
      await refresh(current);
    });
  };

  return {
    opened,
    chatId,
    timeOffset,
    busy,
    failed,
    nothingScheduled,
    stateId: chatId === null ? null : (run?.state ?? flow.start),
    visited: run?.visited ?? NOTHING_VISITED,
    day: chatId === null ? null : (run?.day ?? null),
    open() {
      setOpened(true);
      if (latest.current.chatId === null) void start();
    },
    close: () => setOpened(false),
    reset: () => void start(),
    advance: (ms) => shift((id) => latest.current.connection.advance(id, ms)),
    nextDay: connection.advanceToNextDay ? () => shift((id) => latest.current.connection.advanceToNextDay!(id)) : null,
    nextFirstMessage: connection.advanceToNextFirstMessage ? () => shift((id) => latest.current.connection.advanceToNextFirstMessage!(id)) : null,
  };
}
