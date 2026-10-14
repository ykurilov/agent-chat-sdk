import type { ComponentType } from "react";

// Договор скина экрана карточки клиента, версия 1. Слой поведения (`ClientCardPanel`, этап 8) грузит карточку и
// стирает поля; скин только рисует. Надписи — `useFlowLabels().clientCard`.

export type ClientCardLoadState = "loading" | "ready" | "failed";

export interface ClientCardFieldView {
  fieldId: string;
  name: string;
  /** Значение готовой строкой. */
  value: string;
  /** Когда записано, готовой строкой («12.10.2026»). */
  updatedAt: string;
  /** Пора уточнить (`refreshAfterMonths` прошёл). */
  stale: boolean;
  /** Идёт стирание этого поля. */
  busy: boolean;
  onForget(): void;
}

export interface ClientCardPanelProps {
  state: ClientCardLoadState;
  fields: ClientCardFieldView[];
  /** Идёт «стереть всё». */
  forgettingAll: boolean;
  /** Скин сам спрашивает подтверждение (`labels.forgetAllConfirm`) и только потом зовёт. */
  onForgetAll(): void;
  onRetry(): void;
}

export interface ClientCardSkin {
  ClientCardPanel: ComponentType<ClientCardPanelProps>;
}
