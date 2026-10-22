/** Adapted from @ykurilov/tandem-ui 0.7.0 src/components/dialog.tsx (MIT).
 * Skin-owned renderer: Phosphor icons; upstream behaviour and accessible Radix primitives retained.
 * Keep this file independent of the upstream icon-bearing components. See TANDEM_NOTICES.md.
 */
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon as X } from "@phosphor-icons/react"
import { cn } from "@tandem/ui"
import { useTandemLabels, type DialogLabels } from "@tandem/ui"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "center" | "right"
    /** Надписи на другом языке. Главнее общего TandemLabelsProvider. */
    labels?: Partial<DialogLabels>
  }
>(({ className, children, side = "center", labels: overrides, ...props }, ref) => {
  const labels = useTandemLabels("dialog", overrides)
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="tandem-overlay fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--foreground)_45%,transparent)]" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]",
          side === "center"
            ? "tandem-pop left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-panel)]"
            : "tandem-sheet inset-y-0 right-0 w-[min(28rem,100vw)] border-y-0 border-r-0",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="tandem-focus absolute right-4 top-4 grid size-9 place-items-center rounded-[var(--radius-small)] text-[var(--foreground-subtle)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          aria-label={labels.close}
        >
          <X weight="regular" className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-[var(--border)] px-[var(--space-panel)] py-[var(--space-panel)] pr-16", className)} {...props} />
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold tracking-[-0.015em] text-[var(--foreground)]", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm leading-5 text-[var(--foreground-muted)]", className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("max-h-[60vh] overflow-y-auto p-[var(--space-panel)]", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-[var(--space-related)] border-t border-[var(--border)] p-[var(--space-panel)]", className)} {...props} />
}
