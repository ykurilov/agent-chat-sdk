import type { ClientCardSkin } from "@ykurilov/agent-chat-flows/react";
import { TandemClientCardPanel } from "./client-card-panel";

/** Скин экрана карточки клиента Тандема: ставится в `ClientCardPanel` из `@ykurilov/agent-chat-flows/react`. */
export const tandemClientCardSkin: ClientCardSkin = { ClientCardPanel: TandemClientCardPanel };
