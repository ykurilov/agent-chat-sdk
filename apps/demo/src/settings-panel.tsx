import { AgentAvatar, Button, Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@tandem/ui";
import { Brain, FlaskConical, ListChecks, ListCollapse, MessageSquare, Moon, Puzzle, Sun, Wrench } from "lucide-react";
import { demoFailures, demoUsers } from "./demo-settings";
import type { DemoFailureId, DemoTheme, DemoUserId } from "./demo-settings";

interface SettingsPanelProps {
  /**
   * Что открыто: чат, экран памяти, страница мессенджеров (`/messengers`), навыков (`/skills`) или серверов MCP (`/mcp`) —
   * без кнопок: шапка на телефоне узкая, — или страница с панелью агента.
   */
  view: "chat" | "memory" | "messengers" | "skills" | "mcp" | "panel-app" | "sandbox" | "lesson";
  user: DemoUserId;
  onUserChange: (user: DemoUserId) => void;
  failure: DemoFailureId;
  onFailureChange: (failure: DemoFailureId) => void;
  customToolRow: boolean;
  onCustomToolRowChange: (on: boolean) => void;
  simpleWorkView: boolean;
  onSimpleWorkViewChange: (on: boolean) => void;
  theme: DemoTheme;
  onThemeChange: (theme: DemoTheme) => void;
}

/**
 * Верхняя панель стенда: пользователь, переход между чатом и памятью, имитация сбоя, своя строка вызова, простой вид
 * работы агента, тема.
 * Модель и провайдер выбираются в поле ввода чата.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  return (
    <header className="flex items-center gap-2 sm:gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-2.5 sm:px-6">
      <div className="hidden items-center gap-2.5 sm:flex">
        <AgentAvatar />
        <span className="text-sm font-semibold">Демо чата с агентом</span>
      </div>
      <div className="ml-auto flex items-center gap-0.5 sm:gap-2">
        <Choice
          label="Пользователь"
          options={demoUsers}
          value={props.user}
          onChange={(id) => props.onUserChange(id as DemoUserId)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-8"
          aria-label={props.view === "memory" ? "Чат" : "Память агента"}
          onClick={() => location.assign(props.view === "memory" ? "/" : "/memory")}
        >
          {props.view === "memory" ? <MessageSquare /> : <Brain />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-8"
          aria-label={props.view === "panel-app" ? "Чат" : "Приложение с панелью"}
          onClick={() => location.assign(props.view === "panel-app" ? "/" : "/panel-app")}
        >
          {props.view === "panel-app" ? <MessageSquare /> : <ListChecks />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-8"
          aria-label={props.view === "sandbox" ? "Чат" : "Песочница агента"}
          onClick={() => location.assign(props.view === "sandbox" ? "/" : "/sandbox")}
        >
          {props.view === "sandbox" ? <MessageSquare /> : <Wrench />}
        </Button>
        <FailureMenu value={props.failure} onChange={props.onFailureChange} />
        <Button
          variant={props.customToolRow ? "secondary" : "ghost"}
          size="icon"
          className="max-sm:size-8"
          aria-label="Свой ToolCallRow"
          aria-pressed={props.customToolRow}
          title={props.customToolRow ? "Строка вызова из приложения" : "Строка вызова из выбранного скина"}
          onClick={() => props.onCustomToolRowChange(!props.customToolRow)}
        >
          <Puzzle />
        </Button>
        <Button
          variant={props.simpleWorkView ? "secondary" : "ghost"}
          size="icon"
          className="max-sm:hidden"
          aria-label="Простой вид"
          aria-pressed={props.simpleWorkView}
          title={props.simpleWorkView ? "Работа агента: живая строка и свёрнутые шаги" : "Работа агента: мысли и строки вызовов"}
          onClick={() => props.onSimpleWorkViewChange(!props.simpleWorkView)}
        >
          <ListCollapse />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="max-sm:size-8"
          aria-label={props.theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          onClick={() => props.onThemeChange(props.theme === "dark" ? "light" : "dark")}
        >
          {props.theme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

/** Имитация сбоя провайдера: пока она включена, кнопка тёплого цвета. */
function FailureMenu({ value, onChange }: { value: DemoFailureId; onChange: (failure: DemoFailureId) => void }) {
  const active = value !== "none";
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant={active ? "warm" : "ghost"}
          size="icon"
          className="max-sm:size-8"
          aria-label="Имитация сбоя"
          title={demoFailures.find((failure) => failure.id === value)?.name}
        >
          <FlaskConical />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Имитация сбоя провайдера</MenuLabel>
        <MenuRadioGroup value={value} onValueChange={(id) => onChange(id as DemoFailureId)}>
          {demoFailures.map((failure) => (
            <MenuRadioItem key={failure.id} value={failure.id}>
              {failure.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: string; name: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[var(--radius-small)] bg-[var(--surface-muted)] p-0.5">
      {options.map((option) => (
        <Button
          key={option.id}
          size="sm"
          variant={option.id === value ? "secondary" : "ghost"}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className="h-7 px-[5px] text-xs sm:px-2.5"
        >
          {option.name}
        </Button>
      ))}
    </div>
  );
}
