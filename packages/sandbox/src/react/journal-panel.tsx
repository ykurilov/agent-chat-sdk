import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import type { AnswerEditMark, JournalListResponse } from "../types";
import {
  formatCost,
  formatTime,
  journalRows,
  journalTurns,
  messageToolDetailsView,
  modelCallDetailsView,
  previousModelCall,
  toolCallDetailsView,
} from "./journal-view";
import type { JournalRowSource } from "./journal-view";
import type { SandboxClient } from "./sandbox-client";
import { useSandboxLabels } from "./sandbox-labels";
import type { JournalRowView, ModelCallDetailsView, SandboxSkin, ToolCallDetailsView } from "./sandbox-skin";

type Entries = JournalListResponse["entries"];
type Loaded<View> = { state: "loading" } | { state: "failed" } | { state: "ready"; view: View };

/**
 * Журнал открытого чата: обращения к модели и вызовы инструментов хода или всего чата. Записи грузятся при открытии
 * чата и перечитываются после конца каждого хода; подробности строки — по нажатию, один раз.
 */
export function JournalPanel({
  skin,
  client,
  chatId,
  messages,
  busy,
  edits,
}: {
  skin: SandboxSkin;
  client: SandboxClient;
  chatId: string;
  /** Сообщения текущей ветки. */
  messages: AgentChatMessage[];
  busy: boolean;
  edits: ReadonlyMap<string, AnswerEditMark>;
}) {
  const labels = useSandboxLabels();
  const [load, setLoad] = useState<{ state: "loading" | "ready" | "failed"; entries: Entries }>({ state: "loading", entries: [] });
  const [turnId, setTurnId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [details, setDetails] = useState<Record<string, Loaded<ModelCallDetailsView | ToolCallDetailsView>>>({});
  const request = useRef(0);

  const reload = useCallback(() => {
    const ticket = ++request.current;
    client.journal(chatId).then(
      (entries) => ticket === request.current && setLoad({ state: "ready", entries }),
      () => ticket === request.current && setLoad((current) => ({ ...current, state: "failed" })),
    );
  }, [client, chatId]);

  useEffect(() => {
    setLoad({ state: "loading", entries: [] });
    setTurnId(null);
    setOpenIds(new Set());
    setDetails({});
    reload();
  }, [reload]);

  // Ход закончился: журнал уже записал его обращения и вызовы.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) reload();
    wasBusy.current = busy;
  }, [busy, reload]);

  const turns = journalTurns(messages, labels);
  const currentTurnId = turns.some((turn) => turn.id === turnId) ? turnId : null;
  const sources = journalRows(load.entries, messages, edits, currentTurnId);

  const loadDetails = async (row: Extract<JournalRowSource, { kind: "model" | "tool" }>) => {
    setDetails((current) => ({ ...current, [row.id]: { state: "loading" } }));
    try {
      let view: ModelCallDetailsView | ToolCallDetailsView;
      if (row.kind === "model") {
        const previous = previousModelCall(load.entries, row.id);
        const [call, previousCall] = await Promise.all([client.call(row.id), previous ? client.call(previous.id) : null]);
        if (call.kind !== "model") throw new Error("journal call kind mismatch");
        const previousHashes = previousCall?.kind === "model" ? new Set(previousCall.messages.map((blob) => blob.hash)) : null;
        view = modelCallDetailsView(call, previousHashes);
      } else {
        const call = await client.call(row.id);
        if (call.kind !== "tool") throw new Error("journal call kind mismatch");
        view = toolCallDetailsView(call);
      }
      setDetails((current) => ({ ...current, [row.id]: { state: "ready", view } }));
    } catch {
      setDetails((current) => ({ ...current, [row.id]: { state: "failed" } }));
    }
  };

  const openChange = (row: JournalRowSource) => (open: boolean) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (open) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
    if (open && row.kind !== "message-tool" && (details[row.id] === undefined || details[row.id]?.state === "failed")) void loadDetails(row);
  };

  const detailsOf = (row: JournalRowSource) => {
    if (row.kind === "message-tool") return <skin.ToolCallDetails {...messageToolDetailsView(row.part)} />;
    const loaded = details[row.id] ?? { state: "loading" };
    const view =
      loaded.state === "ready" ? loaded.view : loaded.state === "failed" ? { state: "failed" as const, onRetry: () => void loadDetails(row) } : { state: "loading" as const };
    return row.kind === "model" ? <skin.ModelCallDetails {...(view as ModelCallDetailsView)} /> : <skin.ToolCallDetails {...(view as ToolCallDetailsView)} />;
  };

  const rows = sources.map((row): JournalRowView => {
    const open = openIds.has(row.id);
    const common = { id: row.id, open, onOpenChange: openChange(row), ...(open && { details: detailsOf(row) }) };
    if (row.kind === "model") {
      const { entry } = row;
      const cost = formatCost(entry.costUsd);
      return {
        ...common,
        kind: "model",
        purpose: entry.purpose,
        attempt: entry.attempt,
        modelId: entry.modelId,
        status: entry.status,
        time: formatTime(entry.startedAt),
        durationMs: entry.durationMs,
        firstChunkMs: entry.firstChunkMs,
        inputTokens: entry.usage?.inputTokens ?? null,
        cachedInputTokens: entry.usage?.cachedInputTokens ?? null,
        outputTokens: entry.usage?.outputTokens ?? null,
        ...(cost !== undefined && { cost }),
        instructionsChanged: entry.instructionsChanged,
      };
    }
    const title = row.part?.title;
    if (row.kind === "tool") {
      return {
        ...common,
        kind: "tool",
        toolName: row.entry.toolName,
        ...(title !== undefined && { title }),
        source: "server",
        status: row.entry.error === null ? "complete" : "error",
        time: formatTime(row.entry.startedAt),
        durationMs: row.entry.durationMs,
        outputEdited: row.outputEdited,
      };
    }
    return {
      ...common,
      kind: "tool",
      toolName: row.part.toolName,
      ...(title !== undefined && { title }),
      source: "message",
      status: row.part.state === "output-error" ? "error" : "complete",
      time: "",
      durationMs: null,
      outputEdited: row.outputEdited,
    };
  });

  const state = load.state === "ready" && rows.length === 0 ? "empty" : load.state;
  return (
    <skin.JournalList
      state={state}
      rows={rows}
      {...(load.state === "failed" && { onRetry: reload })}
      turns={turns}
      currentTurnId={currentTurnId}
      onTurnChange={setTurnId}
    />
  );
}
