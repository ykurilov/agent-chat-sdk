/** Adapted from @ykurilov/tandem-ui 0.7.0 src/components/agent-message.tsx (MIT).
 * Skin-owned renderer: Phosphor icons; upstream behaviour and accessible Radix primitives retained.
 * Keep this file independent of the upstream icon-bearing components. See TANDEM_NOTICES.md.
 */
import type { HTMLAttributes } from "react"
import { cn } from "@tandem/ui"


/** Только оболочка сообщения человека. Текст модели всегда проходит через SafeMarkdown. */
export function UserMessageShell({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-w-0 max-w-[75%] px-[var(--control-pad-md)] py-3 text-sm leading-6", "ml-auto rounded-[18px] rounded-br-md bg-[var(--action)] text-[var(--action-foreground)]", className)} {...props}>
      {children}
    </div>
  )
}
