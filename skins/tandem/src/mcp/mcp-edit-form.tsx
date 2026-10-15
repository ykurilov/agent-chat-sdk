import { Alert, Button, Field, Input } from "@tandem/ui";
import { useMcpLabels } from "@ykurilov/agent-chat-mcp/react";
import type { McpServerCardView, McpServerEditValues } from "@ykurilov/agent-chat-mcp/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { NameAndPrefixFields, NewHeaderRow, ProxyAndTimeoutFields, TransportField } from "./mcp-form-fields";
import type { McpCommonFields } from "./mcp-form-fields";

/** Заголовок, который уже задан: значение экран не знает. `replacement` — новое значение, `null` — оставить прежнее. */
interface StoredHeader {
  name: string;
  replacement: string | null;
}

/** Строка заданного заголовка: «задан», «Заменить» открывает пустое поле пароля, «Очистить» убирает заголовок. */
function StoredHeaderRow({ header, onReplace, onClear }: { header: StoredHeader; onReplace(value: string): void; onClear(): void }) {
  const labels = useMcpLabels();
  return (
    <div role="group" aria-label={header.name} className="flex min-w-0 flex-wrap items-center gap-2">
      {header.replacement === null ? (
        <>
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--foreground)]">{labels.headerIsSet(header.name)}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => onReplace("")}>
            {labels.headerReplace}
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 truncate font-mono text-sm text-[var(--foreground)]">{header.name}</span>
          <Input aria-label={labels.headerValue} className="min-w-0 flex-1" type="password" value={header.replacement} onChange={(event) => onReplace(event.target.value)} autoComplete="new-password" autoFocus />
        </>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        {labels.headerClear}
      </Button>
    </div>
  );
}

/** Форма «Изменить сервер»: поля с карточки; адрес и значения заголовков не показываются — их можно только заменить. */
export function McpEditForm({ server }: { server: McpServerCardView }) {
  const labels = useMcpLabels();
  const form = server.edit;
  const [values, setValues] = useState<McpCommonFields & { url: string }>(() => ({
    name: server.name,
    prefix: server.prefix,
    url: "",
    transport: server.transport,
    viaProxy: server.viaProxy,
    timeoutSeconds: server.timeoutMs / 1000,
  }));
  const [stored, setStored] = useState<StoredHeader[]>(() => server.headerNames.map((name) => ({ name, replacement: null })));
  const [added, setAdded] = useState<Array<{ name: string; value: string }>>([]);
  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const edited: McpServerEditValues = {
      ...values,
      headers: [...stored.map((header) => ({ name: header.name, value: header.replacement })), ...added],
    };
    form.onSubmit(edited);
  };

  return (
    <form
      aria-label={labels.editServer}
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface-muted)] p-4"
    >
      <NameAndPrefixFields values={values} onChange={set} />
      <Field label={labels.fieldUrl} hint={labels.fieldUrlKeepHint}>
        <Input type="url" value={values.url} onChange={(event) => set({ url: event.target.value })} autoComplete="off" spellCheck={false} placeholder={server.displayUrl} />
      </Field>
      <TransportField values={values} onChange={set} />
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium text-[var(--foreground)]">{labels.fieldHeaders}</legend>
        {stored.map((header) => (
          <StoredHeaderRow
            key={header.name}
            header={header}
            onReplace={(replacement) => setStored((current) => current.map((item) => (item.name === header.name ? { ...item, replacement } : item)))}
            onClear={() => setStored((current) => current.filter((item) => item.name !== header.name))}
          />
        ))}
        {added.map((header, index) => (
          <NewHeaderRow
            key={index}
            header={header}
            onChange={(patch) => setAdded((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)))}
            onRemove={() => setAdded((current) => current.filter((_, at) => at !== index))}
          />
        ))}
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAdded((current) => [...current, { name: "", value: "" }])}>
          <Plus aria-hidden="true" className="size-4" />
          {labels.addHeader}
        </Button>
      </fieldset>
      <ProxyAndTimeoutFields values={values} onChange={set} />
      {form.error && <Alert variant="warm" title={form.error} className="w-full" />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={form.onCancel} disabled={form.busy}>
          {labels.cancel}
        </Button>
        <Button type="submit" loading={form.busy} disabled={form.busy}>
          {labels.saveChanges}
        </Button>
      </div>
    </form>
  );
}
