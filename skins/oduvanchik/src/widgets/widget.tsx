import type { WidgetView } from "@ykurilov/agent-chat-react";
import { OduvanchikChoiceWidget } from "./choice";
import { OduvanchikCustomWidget } from "./custom-fallback";
import { OduvanchikFormWidget } from "./form";
import { OduvanchikMultiChoiceWidget } from "./multi-choice";
import { OduvanchikRatingWidget } from "./rating";

/** Виджет агента в ленте (договор скина v13): ждущий, отвеченный или закрытый. */
export function OduvanchikWidget(view: WidgetView) {
  switch (view.kind) {
    case "choice":
      return <OduvanchikChoiceWidget {...view} />;
    case "multi_choice":
      return <OduvanchikMultiChoiceWidget {...view} />;
    case "rating":
      return <OduvanchikRatingWidget {...view} />;
    case "form":
      return <OduvanchikFormWidget {...view} />;
    case "custom":
      return <OduvanchikCustomWidget {...view} />;
  }
}
