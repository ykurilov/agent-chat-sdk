import type { WidgetView } from "@ykurilov/agent-chat-react";
import { TandemChoiceWidget } from "./choice";
import { TandemCustomWidget } from "./custom-fallback";
import { TandemFormWidget } from "./form";
import { TandemMultiChoiceWidget } from "./multi-choice";
import { TandemRatingWidget } from "./rating";

/** Виджет агента в ленте (договор скина v13): ждущий, отвеченный или закрытый. */
export function TandemWidget(view: WidgetView) {
  switch (view.kind) {
    case "choice":
      return <TandemChoiceWidget {...view} />;
    case "multi_choice":
      return <TandemMultiChoiceWidget {...view} />;
    case "rating":
      return <TandemRatingWidget {...view} />;
    case "form":
      return <TandemFormWidget {...view} />;
    case "custom":
      return <TandemCustomWidget {...view} />;
  }
}
