import { Tooltip as TandemTooltip, TooltipRoot, TooltipTrigger, TooltipContent } from "@tandem/ui";
import type { ComponentProps } from "react";

/** Same primitive behaviour; the portal belongs to this skin's embedded CSS scope. */
export function Tooltip({ label, children, side = "top" }: ComponentProps<typeof TandemTooltip>) {
  return <TooltipRoot><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent data-agent-chat-oduvanchik="" side={side}>{label}</TooltipContent></TooltipRoot>;
}
