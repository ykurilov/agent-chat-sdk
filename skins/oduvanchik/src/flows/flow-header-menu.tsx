import { Menu, Button, type IconComponent } from "@ykurilov/ds-react";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { isValidElement, type ReactNode } from "react";

export interface FlowHeaderMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  onSelect(): void;
}

/** DS owns placement, keyboard navigation and focus return. */
export function FlowHeaderMenu({ label, items, className }: { label: string; items: FlowHeaderMenuItem[]; className?: string }) {
  return <span className={className} data-flow-header-menu="">
    <Menu label={label} align="end" trigger={<Button variant="ghost" size="sm" icon={DotsThreeIcon} aria-label={label} title={label} />}
      entries={items.map((item) => ({ label: item.label, disabled: item.disabled, onSelect: item.onSelect,
        ...(isValidElement(item.icon) ? { icon: item.icon.type as IconComponent } : {}) }))} />
  </span>;
}
