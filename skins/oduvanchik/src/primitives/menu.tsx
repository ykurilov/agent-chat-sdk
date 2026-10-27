/** Adapted from @ykurilov/tandem-ui 0.7.0 src/components/menu.tsx (MIT).
 * Skin-owned renderer: Phosphor icons; upstream behaviour and accessible Radix primitives retained.
 * Keep this file independent of the upstream icon-bearing components. See TANDEM_NOTICES.md.
 */
import * as React from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { CheckIcon as Check, CaretRightIcon as ChevronRight } from "@phosphor-icons/react"
import { cn } from "@tandem/ui"

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger

export const MenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Content> & { container?: HTMLElement | null }
>(({ className, sideOffset = 8, align = "start", container, ...props }, ref) => (
  // container нужен, когда меню открывается внутри модальной панели: по умолчанию
  // Radix портирует его в body, то есть за пределы ловушки фокуса этой панели.
  <DropdownMenu.Portal container={container ?? undefined}>
    <DropdownMenu.Content
      data-agent-chat-oduvanchik=""
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        "tandem-pop z-50 min-w-[200px] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-md)]",
        className
      )}
      {...props}
    />
  </DropdownMenu.Portal>
))
MenuContent.displayName = DropdownMenu.Content.displayName

export const MenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> & { destructive?: boolean }
>(({ className, destructive = false, ...props }, ref) => (
  <DropdownMenu.Item
    ref={ref}
    className={cn(
      // Radix ведёт клавиатуру сам и метит активный пункт через data-highlighted.
      // Один и тот же стиль на мышь и на клавиши: иначе они расходятся.
      "flex cursor-default select-none items-center gap-[var(--space-related)] rounded-[var(--radius-small)] px-3 py-2.5 text-sm text-[var(--foreground-muted)] outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
      destructive && "text-[var(--destructive-text)] data-[highlighted]:bg-[var(--destructive)] data-[highlighted]:text-[var(--destructive-foreground)]",
      className
    )}
    {...props}
  />
))
MenuItem.displayName = DropdownMenu.Item.displayName

export const MenuSub = DropdownMenu.Sub

export const MenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenu.SubTrigger
    ref={ref}
    className={cn(
      // Открытое подменю держит подсветку родителя: иначе при переходе курсора вправо непонятно, чьи это пункты.
      "flex cursor-default select-none items-center gap-[var(--space-related)] rounded-[var(--radius-small)] px-3 py-2.5 text-sm text-[var(--foreground-muted)] outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--foreground)] data-[state=open]:bg-[var(--surface-hover)] data-[state=open]:text-[var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight weight="regular" aria-hidden="true" className="ml-auto text-[var(--foreground-subtle)]" />
  </DropdownMenu.SubTrigger>
))
MenuSubTrigger.displayName = DropdownMenu.SubTrigger.displayName

export const MenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.SubContent> & { container?: HTMLElement | null }
>(({ className, sideOffset = 6, container, ...props }, ref) => (
  <DropdownMenu.Portal container={container ?? undefined}>
    <DropdownMenu.SubContent
      data-agent-chat-oduvanchik=""
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "tandem-pop z-50 min-w-[200px] rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[var(--shadow-md)]",
        className
      )}
      {...props}
    />
  </DropdownMenu.Portal>
))
MenuSubContent.displayName = DropdownMenu.SubContent.displayName

export const MenuRadioGroup = DropdownMenu.RadioGroup

export const MenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.RadioItem> & { description?: React.ReactNode }
>(({ className, description, children, ...props }, ref) => (
  <DropdownMenu.RadioItem
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-start gap-[var(--space-related)] rounded-[var(--radius-small)] px-3 py-2.5 text-sm text-[var(--foreground-muted)] outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] data-[highlighted]:bg-[var(--surface-hover)] data-[highlighted]:text-[var(--foreground)] data-[state=checked]:text-[var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
      className
    )}
    {...props}
  >
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-[var(--space-related)] font-semibold">{children}</span>
      {description && <span className="mt-0.5 block text-xs font-normal text-[var(--foreground-subtle)]">{description}</span>}
    </span>
    {/* Галочка справа, а не слева: так названия в списке стоят ровно по одной линии. */}
    <span className="flex size-5 items-center justify-center text-[var(--action)]">
      <DropdownMenu.ItemIndicator><Check weight="regular" aria-hidden="true" /></DropdownMenu.ItemIndicator>
    </span>
  </DropdownMenu.RadioItem>
))
MenuRadioItem.displayName = DropdownMenu.RadioItem.displayName

export const MenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Label ref={ref} className={cn("px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--foreground-subtle)]", className)} {...props} />
))
MenuLabel.displayName = DropdownMenu.Label.displayName

export const MenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenu.Separator ref={ref} className={cn("my-1.5 h-px bg-[var(--border)]", className)} {...props} />
))
MenuSeparator.displayName = DropdownMenu.Separator.displayName
