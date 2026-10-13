import type { MemorySkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

type MemoryGroupProps = ComponentProps<MemorySkin["MemoryGroup"]>;

const headings = ["h3", "h4", "h5", "h6"] as const;

/** Раздел дерева: заголовок и записи под ним; вложенный раздел сдвинут и отмечен линией слева. */
export function TandemMemoryGroup({ name, depth, count, children }: MemoryGroupProps) {
  const labels = useChatLabels();
  const Heading = headings[Math.min(depth, headings.length - 1)]!;
  return (
    <section
      role="group"
      aria-label={labels.memoryGroupLabel(name, count)}
      className={depth === 0 ? "flex min-w-0 flex-col gap-1" : "ml-2 flex min-w-0 flex-col gap-1 border-l border-[var(--border)] pl-3"}
    >
      <Heading className="break-words px-3 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">{name}</Heading>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </section>
  );
}
