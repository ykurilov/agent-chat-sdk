import type { MessengersSkin } from "@ykurilov/agent-chat-messengers/react";
import { TandemMessengerConnectPanel } from "./messenger-connect-panel";

/** Скин панели мессенджеров (договор скина мессенджеров, версия 1): для `MessengerConnect`. */
export const tandemMessengersSkin: MessengersSkin = {
  MessengerConnectPanel: TandemMessengerConnectPanel,
};

export { TandemMessengerConnectPanel };
