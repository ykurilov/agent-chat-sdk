import { Button } from "@tandem/ui";
import { attachmentsClient } from "@ykurilov/agent-chat-attachments/react";
import { diagramsClient } from "@ykurilov/agent-chat-diagrams";
import { imagesClient } from "@ykurilov/agent-chat-images/react";
import { videosClient } from "@ykurilov/agent-chat-videos/react";
import { ChatLabelsProvider, ChatWorkspace } from "@ykurilov/agent-chat-react";
import type { ChatListSkin, ChatSkin } from "@ykurilov/agent-chat-react";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { createVoiceInput } from "@ykurilov/agent-chat-voice";
import { createVoiceDialogEngine } from "@ykurilov/agent-chat-voice-dialog";
import type { LatencyReport } from "@ykurilov/agent-chat-voice-dialog";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { demoLabels, demoMessageActions, demoStepPhrases, demoWidgets } from "./chat-features";
import { demoComposerActions } from "./demo-composer-actions";
import { demoAppEvents } from "./demo-app-events";
import { CustomToolCallRow } from "./custom-tool-call-row";
import {
  applyTheme,
  currentTheme,
  demoFailures,
  demoUsers,
  readCookie,
  readCustomToolRow,
  readLiveness,
  readSimpleWorkView,
  writeCookie,
  writeCustomToolRow,
  writeSimpleWorkView,
} from "./demo-settings";
import type { DemoFailureId, DemoTheme, DemoUserId } from "./demo-settings";
import { MemoryPage } from "./memory-page";
import { LessonPage, lessonPath } from "./lesson-page";
import { PanelAppRoot, panelAppPath } from "./panel-app/panel-app-root";
import { SettingsPanel } from "./settings-panel";

const api = "/api/chat";
const voice = createVoiceInput({ api: "/api/voice", mode: "relay" });
/**
 * Голосовой режим («разговор»): звук и озвучка идут через наш сервер, ключей в браузере нет.
 * Замер задержки каждого хода («конец фразы → первый звук», по звеньям) копится в `window.voiceDialogLatency`: его читают
 * замер задержки и живая проверка; никуда не отправляется.
 */
const voiceDialog = createVoiceDialogEngine({
  basePath: "/api/voice-dialog",
  onMetrics: (report) => {
    const page = window as unknown as { voiceDialogLatency?: LatencyReport[] };
    (page.voiceDialogLatency ??= []).push(report);
  },
});
/**
 * Страница песочницы грузится лениво: обычный чат её кода не несёт. `VITE_DEMO_SANDBOX=0` вырезает её из сборки
 * совсем (так проверяется, что код песочницы не попадает в боевой пакет).
 */
const SandboxPage = import.meta.env.VITE_DEMO_SANDBOX === "0" ? null : lazy(() => import("./sandbox-page"));
const sandboxPath = "/sandbox";
/** Страница мессенджеров тоже ленивая: `VITE_DEMO_MESSENGERS=0` вырезает её из сборки совсем. */
const MessengersPage = import.meta.env.VITE_DEMO_MESSENGERS === "0" ? null : lazy(() => import("./messengers-page"));
const messengersPath = "/messengers";

/** Экран памяти агента открывается по адресу `/memory`. */
const memoryPath = "/memory";

function chatIdFromUrl(): string | undefined {
  return new URLSearchParams(location.search).get("chat") ?? undefined;
}

/** Открытый чат — в адресе страницы: ссылку можно открыть заново или отправить себе. */
function showChatInUrl(chatId: string | null): void {
  const url = new URL(location.href);
  if (chatId) url.searchParams.set("chat", chatId);
  else url.searchParams.delete("chat");
  history.replaceState(null, "", url);
}

function knownUser(): DemoUserId | null {
  const user = readCookie("demo-user");
  return demoUsers.find((known) => known.id === user)?.id ?? null;
}

function knownFailure(): DemoFailureId {
  const failure = readCookie("demo-failure");
  return demoFailures.find((known) => known.id === failure)?.id ?? "none";
}

export function App() {
  const [user, setUser] = useState<DemoUserId | null>(knownUser);
  const [failure, setFailure] = useState<DemoFailureId>(knownFailure);
  const [theme, setTheme] = useState<DemoTheme>(currentTheme);
  const [customToolRow, setCustomToolRow] = useState(readCustomToolRow);
  const [simpleWorkView, setSimpleWorkView] = useState(readSimpleWorkView);
  const [liveness] = useState(readLiveness);
  const [initialChatId] = useState(chatIdFromUrl);
  const view =
    location.pathname === memoryPath
      ? "memory"
      : location.pathname === lessonPath
        ? "lesson"
      : location.pathname.startsWith(panelAppPath)
        ? "panel-app"
        : SandboxPage && location.pathname === sandboxPath
          ? "sandbox"
          : MessengersPage && location.pathname === messengersPath
            ? "messengers"
            : "chat";
  // Замена одного компонента скина: остальные остаются теми же, поведение чата не трогается.
  const skin = useMemo<ChatSkin & ChatListSkin>(
    () => (customToolRow ? { ...tandemSkin, ToolCallRow: CustomToolCallRow } : tandemSkin),
    [customToolRow],
  );

  const chooseFailure = useCallback((next: DemoFailureId) => {
    // Cookie пишется сразу: следующий запрос, в том числе «повторить», уже идёт с новым значением.
    writeCookie("demo-failure", next);
    setFailure(next);
  }, []);

  const chooseUser = useCallback((next: DemoUserId) => {
    writeCookie("demo-user", next);
    setUser(next);
  }, []);

  if (!user) {
    return (
      <main className="grid h-full place-items-center bg-[var(--canvas)] p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold">Войти тестовым пользователем</h1>
          <div className="flex gap-2">
            {demoUsers.map((demoUser) => (
              <Button key={demoUser.id} variant="secondary" onClick={() => chooseUser(demoUser.id)}>
                {demoUser.name}
              </Button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--canvas)] text-[var(--foreground)]">
      <SettingsPanel
        view={view}
        user={user}
        onUserChange={chooseUser}
        failure={failure}
        onFailureChange={chooseFailure}
        customToolRow={customToolRow}
        onCustomToolRowChange={(on) => {
          writeCustomToolRow(on);
          setCustomToolRow(on);
        }}
        simpleWorkView={simpleWorkView}
        onSimpleWorkViewChange={(on) => {
          writeSimpleWorkView(on);
          setSimpleWorkView(on);
        }}
        theme={theme}
        onThemeChange={(next) => {
          applyTheme(next);
          setTheme(next);
        }}
      />
      <div className="min-h-0 flex-1">
        <ChatLabelsProvider labels={demoLabels}>
          {view === "memory" ? (
            <MemoryPage key={user} api={api} />
          ) : view === "lesson" ? (
            <LessonPage key={user} api={api} skin={skin} />
          ) : view === "sandbox" && SandboxPage ? (
            <Suspense fallback={null}>
              <SandboxPage key={user} />
            </Suspense>
          ) : view === "messengers" && MessengersPage ? (
            <Suspense fallback={null}>
              <MessengersPage key={user} />
            </Suspense>
          ) : view === "panel-app" ? (
            <PanelAppRoot key={user} api={api} userKey={user} />
          ) : (
            <ChatWorkspace
              key={user}
              api={api}
              skin={skin}
              {...(initialChatId && { initialChatId })}
              onChatChange={showChatInUrl}
              liveness={liveness}
              voice={voice}
              voiceDialog={voiceDialog}
              attachments={attachmentsClient}
              widgets={demoWidgets}
              diagrams={diagramsClient}
              liveDemos
              images={imagesClient}
              videos={videosClient}
              messageActions={demoMessageActions}
              composerActions={demoComposerActions}
              appEvents={demoAppEvents}
              spendingLimits
              workView={simpleWorkView ? "simple" : "detailed"}
              stepPhrases={demoStepPhrases}
            />
          )}
        </ChatLabelsProvider>
      </div>
    </div>
  );
}
