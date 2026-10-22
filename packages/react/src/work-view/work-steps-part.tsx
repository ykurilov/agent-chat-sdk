import { usePartOpen } from "../expanded-parts";
import type { ExpandedParts } from "../expanded-parts";
import { useChatLabels } from "../labels";
import type { ChatSkin } from "../skin-contract";
import type { WorkLayoutItem } from "./work-layout";

const keepClosed = () => {};

/**
 * Живая строка или свёрнутые шаги простого вида; скин 28 получает значки и список со раздумьями. Раскрытие — в хранилище чата под своим ключом (`…:work`), отдельно от
 * раскрытия мыслей и строк подробного вида. Скин без `WorkSteps` (до версии 23) получает строку `ToolCallRow`: фраза
 * в `title`, входа нет, а результат — список понятных фраз текстом, по строке на шаг. Ни кода, ни путей.
 */
export function WorkStepsPart({
  skin,
  expanded,
  item,
}: {
  skin: ChatSkin;
  expanded: ExpandedParts;
  item: Exclude<WorkLayoutItem<unknown>, { kind: "shown" }>;
}) {
  const labels = useChatLabels();
  const [open, setOpen] = usePartOpen(expanded, `${item.key}:work`);
  if (skin.WorkSteps) {
    return item.kind === "live" ? (
      <skin.WorkSteps state="live" phrase={item.phrase} icon={item.icon} {...(item.completed && { completed: item.completed })} />
    ) : (
      <skin.WorkSteps
        state="done"
        steps={item.steps}
        count={item.count}
        items={item.items}
        icons={item.icons}
        moreIcons={item.moreIcons}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }
  if (item.kind === "live") return <skin.ToolCallRow toolName={item.phrase} title={item.phrase} state="running" open={false} onOpenChange={keepClosed} />;
  const title = labels.workView.stepsDone(item.count);
  const list = item.steps.map((step) => step.phrase).join("\n");
  return <skin.ToolCallRow toolName={title} title={title} state="done" output={list} open={open} onOpenChange={setOpen} />;
}
