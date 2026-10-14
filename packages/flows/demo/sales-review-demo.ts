// Демо этапа 4: чат по сценарию «Разбор» на модели-заглушке и поддельном судье, без сети и ключей.
// Запуск: pnpm --filter @ykurilov/agent-chat-flows exec tsx --conditions=@ykurilov/agent-chat-source demo/sales-review-demo.ts
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createChatService, createInMemoryChatStorage, extendCatalog, standardCatalog, type ChatService } from "@ykurilov/agent-chat-core";
import { MockLanguageModelV4 } from "ai/test";
import { buildAgentFlow } from "../src/runtime/agent-flow";
import type { FlowJudge } from "../src/runtime/flow-types";
import { memoryFlowStore } from "../src/store/memory";

type StreamPart = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;
type Prompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];

const MODEL_ID = "demo-model";
const OWNER = "demo";

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };
const finish = (reason: "stop" | "tool-calls"): StreamPart => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });
const saying = (text: string): StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: text },
  { type: "text-end", id: "t" },
  finish("stop"),
];
const flowExit = (exit: number, why: string): StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { type: "tool-call", toolCallId: "exit-1", toolName: "flow_exit", input: JSON.stringify({ exit, why }) },
  finish("tool-calls"),
];

/** Что модель-заглушка отвечает по порядку запросов. */
const SCRIPT: StreamPart[][] = [
  saying("Здравствуйте! Я помощник Анны Петровой. О чём ваш курс?"),
  flowExit(1, "Курс про Excel для бухгалтеров, продаж пока не было"),
  saying("Понятно. Давайте найдём, что мешает продажам. Откуда к вам сейчас приходят люди?"),
  saying("Разбор бесплатный и длится 30 минут. А откуда к вам сейчас приходят люди?"),
];

/** Судья-подделка: «Понятны тема курса и продажи» — когда человек назвал и то и другое. */
const demoJudge: FlowJudge = {
  async checkClaim({ exitId, messages }) {
    const said = messages.filter((message) => message.role === "human").map((message) => message.text.toLowerCase()).join(" ");
    const confirmed = exitId === "intro_clear" && said.includes("курс") && said.includes("продаж");
    return { exitId, probability: confirmed ? 0.92 : 0.1, confirmed, source: "decision" };
  },
  async checkAll() {
    return [];
  },
};

/** Запрос без меток кэша: они переезжают на последнее сообщение. */
const plain = (prompt: Prompt) => prompt.map((message) => JSON.stringify(message).replace(/,"providerOptions":\{[^}]*\{[^}]*\}\}/g, ""));

export interface DemoResult {
  /** Реплики разговора: «человек: …» и «агент: …». */
  transcript: string[];
  /** Состояние после каждого хода. */
  states: string[];
  /** Начало каждого запроса к модели — прошлый запрос байт в байт. */
  prefixKept: boolean;
  /** Инструкция одна во всех запросах. */
  sameInstructions: boolean;
}

async function readAll(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

async function stateOf(service: ChatService, chatId: string): Promise<string> {
  const { values } = await service.getChatState(OWNER, chatId);
  return (values.flow as { state: string }).state;
}

export async function runSalesReviewDemo(): Promise<DemoResult> {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<StreamPart>({
        start(controller) {
          for (const part of SCRIPT[call++] ?? saying("…")) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
  const catalog = extendCatalog(standardCatalog, {
    addProviders: [{ id: "demo", displayName: "Демо", apiKeyEnv: "DEMO_KEY", createLanguageModel: () => model, requestOptions: () => ({}) }],
    addModels: [{ id: MODEL_ID, displayName: "Демо-модель", contextWindowTokens: 100_000, acceptsImages: false, reasoning: { replayPastTurns: true }, providerModelIds: { demo: "demo-v1" } }],
  });

  const json = JSON.parse(readFileSync(new URL("../tests/fixtures/sales-review.json", import.meta.url), "utf8"));
  const flow = buildAgentFlow(
    { loadFlow: async () => ({ flowId: "sales-review", versionId: "1", flow: json }), store: memoryFlowStore(), judge: { fallback: { modelId: MODEL_ID, providerId: "demo" } } },
    {
      judge: demoJudge,
      timers: { start() {}, async stop() {}, async tick() {}, async reschedule() {} },
      clientCard: { tools: {}, block: async () => "", read: async () => [], forget: async () => {} },
    },
  );
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog,
    defaultChoice: { modelId: MODEL_ID, providerId: "demo" },
    env: { DEMO_KEY: "demo" },
    logError: () => {},
    ...flow.withChat({ agent: { instructions: "Ты помощник наставника по онлайн-курсам." } }),
  });
  flow.attach(service);

  const chat = await service.createChat(OWNER);
  const human = ["Здравствуйте!", "Курс про Excel для бухгалтеров, продаж пока не было", "А сколько стоит разбор?"];
  const transcript: string[] = [];
  const states: string[] = [];
  for (const [index, text] of human.entries()) {
    await readAll(await service.sendMessage(OWNER, chat.id, { id: `h${index}`, role: "user", parts: [{ type: "text", text }] }));
    await flow.settled();
    const { messages } = await service.getHistory(OWNER, chat.id);
    const answer = messages.at(-1)!;
    const said = answer.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
    transcript.push(`человек: ${text}`, `агент: ${said}`);
    states.push(await stateOf(service, chat.id));
  }

  const prompts = model.doStreamCalls.map((options) => options.prompt);
  const prefixKept = prompts.every((prompt, index) => {
    if (index === 0) return true;
    const before = plain(prompts[index - 1]!);
    return JSON.stringify(plain(prompt).slice(0, before.length)) === JSON.stringify(before);
  });
  const sameInstructions = prompts.every((prompt) => JSON.stringify(prompt[0]) === JSON.stringify(prompts[0]![0]));
  return { transcript, states, prefixKept, sameInstructions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runSalesReviewDemo();
  console.log(result.transcript.join("\n"));
  console.log(`\nсостояния по ходам: ${result.states.join(" → ")}`);
  console.log(`начало запроса цело: ${result.prefixKept ? "да" : "НЕТ"}; инструкция одна: ${result.sameInstructions ? "да" : "НЕТ"}`);
}
