/** Adapted from @ykurilov/tandem-ui 0.7.0 src/components/alert.tsx (MIT).
 * Skin-owned renderer: Phosphor icons; upstream behaviour and accessible Radix primitives retained.
 * Keep this file independent of the upstream icon-bearing components. See TANDEM_NOTICES.md.
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { WarningIcon as AlertTriangle, CheckCircleIcon as CheckCircle2, InfoIcon as Info, XCircleIcon as XCircle } from "@phosphor-icons/react"
import { cn } from "@tandem/ui"

const alertVariants = cva("flex gap-[var(--space-related)] rounded-[var(--radius-panel)] border p-[var(--space-panel)]", {
  variants: {
    variant: {
      info: "border-[var(--cool-border)] bg-[var(--cool-soft)]",
      success: "border-[var(--success-border)] bg-[var(--success-soft)]",
      warm: "border-[var(--warm-border)] bg-[var(--warm-soft)]",
      danger: "border-[var(--border)] bg-[var(--surface)]"
    }
  },
  defaultVariants: { variant: "info" }
})

const ICONS = { info: Info, success: CheckCircle2, warm: AlertTriangle, danger: XCircle }
const TITLE_TONE = {
  info: "text-[var(--cool-text)]",
  success: "text-[var(--success-text)]",
  warm: "text-[var(--warm-text)]",
  danger: "text-[var(--destructive-text)]"
}

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title: string
  action?: React.ReactNode
}

export function Alert({ className, variant = "info", title, action, children, ...props }: AlertProps) {
  const tone = variant ?? "info"
  const Icon = ICONS[tone]
  return (
    // Роль status, а не alert: alert перебивает то, что читает скринридер прямо сейчас,
    // и годится только для настоящего срыва.
    <div role="status" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon weight="regular" className={cn("mt-px size-4 shrink-0", TITLE_TONE[tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold", TITLE_TONE[tone])}>{title}</p>
        {children && <div className="mt-1 text-sm leading-5 text-[var(--foreground-muted)]">{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-[var(--space-inline)]">{action}</div>}
      </div>
    </div>
  )
}

export { alertVariants }
