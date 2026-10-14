import { parseFlow, type AgentFlow, type FlowAppChecks } from "@ykurilov/agent-chat-flows/format";
import { FlowEditor, type FlowMigration } from "@ykurilov/agent-chat-flows/react";
import { tandemFlowEditorSkin } from "@ykurilov/agent-chat-skin-tandem/flows";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import salesReview from "../../../packages/flows/tests/fixtures/sales-review.json";
import sheetsLesson from "../../../packages/flows/tests/fixtures/sheets-lesson.json";
import shopSupport from "../../../packages/flows/tests/fixtures/shop-support.json";
import marathonDays from "../flow-test-chat/marathon-days.json";
import "../src/styles.css";

/*
 * Витрина редактора сценария (этап 5 плана 058): без сервера. Адрес: theme=light|dark, flow=sales-review|shop-support|
 * sheets-lesson|marathon-days (сценарий по дням, поля и проверка приложения), readonly=1 (только просмотр), save=reject|throw
 * (приложение отказывает в сохранении), header=compact, legend=open|hidden, minimap=collapsed|hidden, inspector=collapsible, fullscreen=off (место доски), host=auto (родитель без высоты: редактор берёт высоту сам), root=custom (свои className и style у корня). Сохранение и перевод идущих чатов — заглушки в памяти страницы.
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const fixtures: Record<string, unknown> = {
  "sales-review": salesReview,
  "shop-support": shopSupport,
  "sheets-lesson": sheetsLesson,
  "marathon-days": marathonDays,
};

function loadFixture(name: string): AgentFlow {
  const parsed = parseFlow(fixtures[name] ?? salesReview);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.flow;
}

/** Что умеет «приложение» витрины: инструменты и события всех трёх примеров. */
const catalog = {
  tools: ["give_booking_link", "call_expert", "find_order", "start_refund", "search_knowledge", "call_operator", "check_answer", "show_example"],
  events: ["booking_link", { name: "start_refund", label: "Возврат оформлен" }],
  widgets: [],
  fields: [
    { id: "city", title: "Город", type: "text" as const },
    { id: "tariff", title: "Тариф", type: "choice" as const, options: ["базовый", "с куратором"] },
  ],
};

/** Своя проверка «приложения»: у последнего дня марафона должно быть первое сообщение. */
const checks: FlowAppChecks = (flow) =>
  flow.schedule
    ? flow.states
        .map((state, index) => ({ state, index }))
        .filter(({ state }) => state.id.startsWith("day") && !state.firstMessage)
        .map(({ index }) => ({ path: `states[${index}]`, message: "Приложение: у дня марафона нет утреннего сообщения." }))
    : [];

function Gallery() {
  const [flow, setFlow] = useState(() => loadFixture(params.get("flow") ?? "sales-review"));
  const migration: FlowMigration = {
    chatsByState: async () => {
      const [first, second] = flow.states;
      return [
        ...(first ? [{ versionId: "v1", stateId: first.id, chats: 4 }] : []),
        ...(second ? [{ versionId: "v1", stateId: second.id, chats: 2 }] : []),
        { versionId: "v1", stateId: "old_offer", chats: 1 },
      ];
    },
    migrate: async () => ({ moved: 7 }),
    stateTitle: (_versionId, stateId) => (stateId === "old_offer" ? "Старое предложение" : undefined),
  };
  const save = params.get("save");
  const onSave = async (): Promise<{ ok: false; issues: Array<{ path: string; message: string }> } | undefined> => {
    if (save === "throw") throw new Error("Сервер недоступен");
    if (save === "reject") return { ok: false, issues: [{ path: "states[0]", message: "Приложение: название ноды занято." }] };
    return undefined;
  };
  return (
    <div style={params.get("host") === "auto" ? undefined : { height: "100dvh" }}>
      <FlowEditor
        skin={tandemFlowEditorSkin}
        value={flow}
        onChange={setFlow}
        onSave={onSave}
        readOnly={params.get("readonly") === "1"}
        {...(params.get("header") === "compact" ? { header: "compact" as const } : {})}
        {...(params.get("legend") === "open" || params.get("legend") === "hidden" ? { legend: params.get("legend") as "open" | "hidden" } : {})}
        {...(params.get("minimap") === "collapsed" || params.get("minimap") === "hidden" ? { minimap: params.get("minimap") as "collapsed" | "hidden" } : {})}
        {...(params.get("inspector") === "collapsible" ? { inspector: "collapsible" as const } : {})}
        {...(params.get("fullscreen") === "off" ? { fullscreen: false } : {})}
        {...(params.get("root") === "custom" ? { className: "gallery-custom-root", style: { height: 500, minHeight: 0 } } : {})}
        catalog={catalog}
        checks={checks}
        migration={migration}
        timeZone="Europe/Moscow"
        now={() => Date.UTC(2026, 9, 13, 9)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
