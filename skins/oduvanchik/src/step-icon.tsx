import { cn } from "@tandem/ui";
import type { StepIcon } from "@ykurilov/agent-chat-react";
import { BookOpen, Bookmark, Bot, Brain, Camera, CircleCheck, Clock, Eye, Film, Globe, Image, Pencil, Plug, Search, SquareTerminal, Wrench } from "./icons";
import type { SkinIcon } from "./icons";

const ICONS: Record<string, SkinIcon> = {
  thinking: Brain,
  read: Eye,
  edit: Pencil,
  search: Search,
  web: Globe,
  skill: BookOpen,
  mcp: Plug,
  image: Image,
  video: Film,
  check: CircleCheck,
  snapshot: Camera,
  run: SquareTerminal,
  memory: Bookmark,
  helper: Bot,
  task: Clock,
  tool: Wrench,
};

/** Значок шага (договор 28): тихий, цвета приглушённого текста. Незнакомый вид приложения — общий гаечный ключ. */
export function OduvanchikStepIcon({ icon, className }: { icon: StepIcon; className?: string }) {
  const known = Object.hasOwn(ICONS, icon) ? icon : "tool";
  const Icon = ICONS[known]!;
  return <Icon aria-hidden="true" data-step-icon={known} className={cn("size-3.5 shrink-0", className)} strokeWidth={1.75} />;
}
