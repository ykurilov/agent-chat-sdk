import { Button, Field, Input, Switch } from "@tandem/ui";
import { useMcpLabels } from "@ykurilov/agent-chat-mcp/react";
import type { McpTransportKind } from "@ykurilov/agent-chat-mcp/react";
import { X } from "lucide-react";
import { Segmented } from "./segmented";

const TRANSPORTS: McpTransportKind[] = ["http", "sse"];

/** Поля, общие для форм «Добавить сервер» и «Изменить сервер». */
export interface McpCommonFields {
  name: string;
  prefix: string;
  transport: McpTransportKind;
  viaProxy: boolean;
  timeoutSeconds: number;
}

export function NameAndPrefixFields({ values, onChange }: { values: McpCommonFields; onChange(patch: Partial<McpCommonFields>): void }) {
  const labels = useMcpLabels();
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Field label={labels.fieldName} required>
        <Input value={values.name} onChange={(event) => onChange({ name: event.target.value })} required maxLength={80} />
      </Field>
      <Field label={labels.fieldPrefix} hint={labels.fieldPrefixHint} required>
        <Input value={values.prefix} onChange={(event) => onChange({ prefix: event.target.value })} required maxLength={20} autoComplete="off" spellCheck={false} />
      </Field>
    </div>
  );
}

export function TransportField({ values, onChange }: { values: McpCommonFields; onChange(patch: Partial<McpCommonFields>): void }) {
  const labels = useMcpLabels();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-[var(--foreground)]">{labels.fieldTransport}</span>
      <Segmented label={labels.fieldTransport} options={TRANSPORTS.map((value) => ({ value, title: labels.transportNames[value] }))} value={values.transport} onChange={(transport) => onChange({ transport })} />
    </div>
  );
}

export function ProxyAndTimeoutFields({ values, onChange }: { values: McpCommonFields; onChange(patch: Partial<McpCommonFields>): void }) {
  const labels = useMcpLabels();
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="flex items-start justify-between gap-3 text-sm text-[var(--foreground)]">
        <span className="flex flex-col">
          {labels.fieldViaProxy}
          <span className="text-xs text-[var(--foreground-muted)]">{labels.fieldViaProxyHint}</span>
        </span>
        <Switch checked={values.viaProxy} onCheckedChange={(viaProxy) => onChange({ viaProxy })} />
      </label>
      <Field label={labels.fieldTimeout}>
        <Input type="number" min={1} max={120} value={values.timeoutSeconds} onChange={(event) => onChange({ timeoutSeconds: Number(event.target.value) })} />
      </Field>
    </div>
  );
}

/** Новый заголовок: имя и значение; значение — поле пароля, после сохранения его больше не видно нигде. */
export function NewHeaderRow({ header, onChange, onRemove }: { header: { name: string; value: string }; onChange(patch: { name?: string; value?: string }): void; onRemove(): void }) {
  const labels = useMcpLabels();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input aria-label={labels.headerName} className="min-w-0 flex-1" value={header.name} onChange={(event) => onChange({ name: event.target.value })} autoComplete="off" spellCheck={false} />
      <Input aria-label={labels.headerValue} className="min-w-0 flex-[2]" type="password" value={header.value} onChange={(event) => onChange({ value: event.target.value })} autoComplete="new-password" />
      <Button type="button" variant="ghost" size="sm" aria-label={labels.removeHeader} onClick={onRemove}>
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
