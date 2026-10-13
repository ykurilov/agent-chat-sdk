import { TandemAgentMessage, TandemComposer } from "@ykurilov/agent-chat-skin-tandem";
import { TooltipProvider } from "@tandem/ui";
import type { VoiceDialogError, VoiceDialogState, VoiceDialogView } from "@ykurilov/agent-chat-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";

/*
 * Витрина голосового режима скина Тандем для снимков экрана и проверки вёрстки (T505 плана 016): без сервера и чата,
 * только поле ввода и ответ агента. Что показать, задаёт адрес страницы:
 *   theme=light|dark, state=off|connecting|…|error, error=<код>, level=0..1, voices=<сколько голосов>, speech=0 (озвучки нет),
 *   cut=<хвост> (ответ агента с отметкой «Вы перебили»).
 */

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const voiceNames = ["Профессиональный диктор для аудиокниг", "Анна", "Борис", "Вера", "Глеб"];
const voiceCount = Number(params.get("voices") ?? 0);
const voices = voiceNames.slice(0, voiceCount).map((name, index) => ({ id: `voice-${index}`, name }));

const dialog: VoiceDialogView = {
  state: (params.get("state") ?? "off") as VoiceDialogState,
  ...(params.get("error") && { error: params.get("error") as VoiceDialogError }),
  speechAvailable: params.get("speech") !== "0",
  ...(voiceCount > 0 && { voices, currentVoiceId: "voice-0", onSelectVoice: () => undefined }),
  ...(params.get("level") && { level: Number(params.get("level")) }),
  onToggle: () => undefined,
};

const noop = () => undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-end gap-4 bg-[var(--canvas)] p-3 pb-4">
        <TandemAgentMessage
          status="complete"
          onCopy={noop}
          empty={false}
          notice={null}
          {...(params.get("cut") && { voiceInterrupted: { spokenTail: params.get("cut")! } })}
        >
          <p>Завтра в Батуми будет солнечно, около двадцати градусов, ветер слабый. Вечером возможен небольшой дождь.</p>
        </TandemAgentMessage>
        <TandemComposer
          value=""
          onValueChange={noop}
          onSubmit={noop}
          canSubmit={false}
          busy={false}
          onStop={noop}
          voice={{ state: "idle", onToggle: noop }}
          dialog={dialog}
        />
      </main>
    </TooltipProvider>
  </StrictMode>,
);
