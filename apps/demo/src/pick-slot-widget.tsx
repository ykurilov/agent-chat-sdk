import { Button } from "@tandem/ui";
import type { CustomWidgetProps } from "@ykurilov/agent-chat-react";

type PickSlotInput = { slots: string[] };
type PickSlotAnswer = { slot: string };

/** Свой виджет демо: время встречи кнопками; выбранное подсвечено, после ответа кнопки не нажимаются. */
export function PickSlotWidget({ input, state, answer, onAnswer, pending, failure }: CustomWidgetProps<PickSlotInput, PickSlotAnswer>) {
  return (
    <div role="group" aria-label="Время встречи" data-widget="pick_slot" className="my-2 flex flex-wrap gap-2 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-3">
      {input.slots.map((slot) => (
        <Button
          key={slot}
          size="sm"
          variant={answer?.slot === slot ? "primary" : "secondary"}
          disabled={!onAnswer || pending || state !== "pending"}
          onClick={() => onAnswer?.({ slot })}
        >
          {slot}
        </Button>
      ))}
      {failure && <p role="alert" className="w-full text-xs text-[var(--destructive-text)]">{failure}</p>}
    </div>
  );
}
