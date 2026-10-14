import type { ClientCardSkin } from "../client-card-skin";
import { useClientCard, type UseClientCardOptions } from "./use-client-card";

export interface ClientCardScreenProps extends UseClientCardOptions {
  /** Части экрана: `tandemClientCardSkin` из `@ykurilov/agent-chat-skin-tandem/client-card` или свои по договору. */
  skin: ClientCardSkin;
}

/** Экран «Что агент знает о вас»: рядом с экраном памяти, если приложение его подключило. Надписи — `useFlowLabels().clientCard`. */
export function ClientCardPanel({ skin, ...options }: ClientCardScreenProps) {
  return <skin.ClientCardPanel {...useClientCard(options)} />;
}
