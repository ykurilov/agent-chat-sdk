import { TooltipProvider } from "@tandem/ui";
import { TandemAgentMessage, TandemAgentText, TandemToolCallRow } from "@ykurilov/agent-chat-skin-tandem";
import { tandemSandboxSkin } from "@ykurilov/agent-chat-skin-tandem/sandbox";
import { StrictMode, useState } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина скина песочницы Тандем (T029 плана 026): без сервера. Журнал из трёх записей (обращение раскрыто), редактор
 * инструкции, редактор ответа с JSON результата и правленый ответ с отметками. Адрес: theme=light|dark, journal=1 —
 * на узком экране журнал открыт панелью.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const { SandboxLayout, JournalList, ModelCallDetails, ToolCallDetails, InstructionEditor, AnswerEditor } = tandemSandboxSkin;
type JournalRows = ComponentProps<typeof JournalList>["rows"];

const appInstructions = "Ты — помощник турагентства. Отвечай коротко и по делу.";

function Journal() {
  const [open, setOpen] = useState<Record<string, boolean>>({ m1: true });
  const toggle = (id: string) => (value: boolean) => setOpen((current) => ({ ...current, [id]: value }));
  const rows: JournalRows = [
    {
      kind: "model",
      id: "m1",
      purpose: "answer",
      attempt: 1,
      modelId: "anthropic/claude-sonnet-5-5",
      status: "complete",
      time: "12:05:31",
      durationMs: 2400,
      firstChunkMs: 610,
      inputTokens: 5120,
      cachedInputTokens: 4096,
      outputTokens: 212,
      cost: "$0.0042",
      instructionsChanged: true,
      open: open.m1 ?? false,
      onOpenChange: toggle("m1"),
      details: (
        <ModelCallDetails
          state="ready"
          instructions="Отвечай стихами."
          messages={[
            { role: "system", content: "Отвечай стихами.", isNew: false, truncated: false },
            { role: "user", content: "Куда поехать в октябре?", isNew: true, truncated: false },
          ]}
          tools={[{ name: "search_tours", description: "Ищет туры по стране и месяцу", inputSchema: '{\n  "country": "string"\n}' }]}
          settings={'{\n  "temperature": 0.7\n}'}
          response={{ text: "", reasoning: "", toolCalls: [{ toolCallId: "s1", toolName: "search_tours", input: '{"country":"Греция"}' }], finishReason: "tool-calls" }}
          error={null}
        />
      ),
    },
    {
      kind: "tool",
      id: "t1",
      toolName: "search_tours",
      title: "Поиск туров",
      source: "server",
      status: "complete",
      time: "12:05:33",
      durationMs: 180,
      outputEdited: false,
      open: open.t1 ?? false,
      onOpenChange: toggle("t1"),
      details: <ToolCallDetails state="ready" input='{"country":"Греция"}' output={'{\n  "found": 3\n}'} error={null} truncated={false} />,
    },
    {
      kind: "tool",
      id: "message:w1",
      toolName: "ask_choice",
      source: "message",
      status: "complete",
      time: "12:05:36",
      durationMs: null,
      outputEdited: true,
      open: open["message:w1"] ?? false,
      onOpenChange: toggle("message:w1"),
      details: <ToolCallDetails state="loading" />,
    },
  ];
  const [turn, setTurn] = useState<string | null>(null);
  return (
    <JournalList
      state="ready"
      rows={rows}
      turns={[
        { id: null, label: "Весь чат" },
        { id: "a1", label: "Ответ 1" },
      ]}
      currentTurnId={turn}
      onTurnChange={setTurn}
    />
  );
}

function Gallery() {
  const [instructions, setInstructions] = useState("Отвечай стихами.");
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const [journalOpen, setJournalOpen] = useState(params.get("journal") === "1");
  const [text, setText] = useState("Греция в октябре — тёплое море и мало туристов.");
  const [output, setOutput] = useState('{\n  "found": 2\n}');
  const outputError = (() => {
    try {
      JSON.parse(output);
      return undefined;
    } catch {
      return "Неверный JSON";
    }
  })();
  return (
    <TooltipProvider>
      <main className="h-dvh">
        <SandboxLayout
          header={
            <InstructionEditor
              value={instructions}
              onValueChange={setInstructions}
              appInstructions={appInstructions}
              edited
              dirty={instructions !== "Отвечай стихами."}
              onSave={() => undefined}
              canSave
              saving={false}
              onReset={() => setInstructions(appInstructions)}
              open={instructionsOpen}
              onOpenChange={setInstructionsOpen}
              maxLength={100_000}
            />
          }
          chat={
            <div className="h-full overflow-y-auto px-3 py-4">
              <TandemAgentMessage status="complete" onCopy={() => undefined} empty={false} notice={null} edited onEdit={() => undefined}>
                <TandemToolCallRow toolName="search_tours" state="done" input={{ country: "Греция" }} output={{ found: 2 }} open={false} onOpenChange={() => undefined} outputEdited />
                <TandemAgentText markdown="Нашёл два тура в Грецию на октябрь." streaming={false} />
              </TandemAgentMessage>
              <AnswerEditor
                text={text}
                onTextChange={setText}
                textError={text.trim() === "" ? "Текст ответа не может быть пустым" : undefined}
                toolOutputs={[
                  { toolCallId: "s1", toolName: "search_tours", title: "Поиск туров", value: output, onValueChange: setOutput, error: outputError, edited: output !== '{\n  "found": 3\n}' },
                ]}
                onSave={() => undefined}
                onCancel={() => undefined}
                canSave={!outputError && text.trim() !== ""}
                saving={false}
              />
            </div>
          }
          journal={<Journal />}
          journalOpen={journalOpen}
          onJournalOpenChange={setJournalOpen}
        />
      </main>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
