import { Button, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@tandem/ui";
import type { VoiceDialogView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { ChevronDown, Volume2 } from "lucide-react";

/**
 * Меню голосов (стоит в панели режима: на широком экране в ряду с выходом, на узком отдельной строкой под ними): кнопка с именем текущего голоса и список с отметкой. Одного голоса, пустого списка или отсутствия
 * `onSelectVoice` достаточно, чтобы меню не показывать: выбирать нечего или нечем.
 */
export function TandemVoiceMenu({ dialog }: { dialog: VoiceDialogView }) {
  const words = useChatLabels().voiceDialog;
  const { voices, onSelectVoice } = dialog;
  if (!voices || voices.length < 2 || !onSelectVoice) return null;
  const current = voices.find((voice) => voice.id === dialog.currentVoiceId);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          aria-label={current ? `${words.voiceMenu}: ${current.name}` : words.voiceMenu}
          style={{ minHeight: 44 }}
          className="order-1 max-w-full gap-2 max-[30rem]:order-4 max-[30rem]:basis-full"
        >
          <Volume2 aria-hidden="true" />
          <span className="min-w-0 truncate">{current?.name ?? words.voiceMenu}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] max-w-[min(24rem,var(--radix-dropdown-menu-content-available-width))] overflow-y-auto">
        <MenuRadioGroup value={current?.id ?? ""} onValueChange={onSelectVoice}>
          {voices.map((voice) => (
            <MenuRadioItem key={voice.id} value={voice.id} style={{ minHeight: 44 }} className="items-center">
              {voice.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
