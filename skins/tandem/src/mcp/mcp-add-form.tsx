import { Alert, Button, Field, Input } from "@tandem/ui";
import { useMcpLabels } from "@ykurilov/agent-chat-mcp/react";
import type { McpAddFormView, McpServerFormValues, McpServerStatus } from "@ykurilov/agent-chat-mcp/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { NameAndPrefixFields, NewHeaderRow, ProxyAndTimeoutFields, TransportField } from "./mcp-form-fields";
import { Segmented } from "./segmented";

const STATUSES: McpServerStatus[] = ["off", "admins", "everyone"];

const emptyForm = (): McpServerFormValues => ({
  name: "",
  prefix: "",
  url: "",
  transport: "http",
  headers: [{ name: "", value: "" }],
  viaProxy: false,
  timeoutSeconds: 30,
  status: "admins",
});

/** Форма «Добавить сервер». Значения заголовков — поле пароля: после отправки их больше не видно нигде. */
export function McpAddForm({ form }: { form: McpAddFormView }) {
  const labels = useMcpLabels();
  const [values, setValues] = useState(emptyForm);
  const set = (patch: Partial<McpServerFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.onSubmit(values);
  };

  return (
    <form
      aria-label={labels.addServer}
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <NameAndPrefixFields values={values} onChange={set} />
      <Field label={labels.fieldUrl} hint={labels.fieldUrlHint} required>
        <Input type="url" value={values.url} onChange={(event) => set({ url: event.target.value })} required autoComplete="off" spellCheck={false} placeholder="https://" />
      </Field>
      <TransportField values={values} onChange={set} />
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-sm font-medium text-[var(--foreground)]">{labels.fieldHeaders}</legend>
        <p className="text-xs text-[var(--foreground-muted)]">{labels.fieldHeadersHint}</p>
        {values.headers.map((header, index) => (
          <NewHeaderRow
            key={index}
            header={header}
            onChange={(patch) => set({ headers: values.headers.map((item, at) => (at === index ? { ...item, ...patch } : item)) })}
            onRemove={() => set({ headers: values.headers.filter((_, at) => at !== index) })}
          />
        ))}
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => set({ headers: [...values.headers, { name: "", value: "" }] })}>
          <Plus aria-hidden="true" className="size-4" />
          {labels.addHeader}
        </Button>
      </fieldset>
      <ProxyAndTimeoutFields values={values} onChange={set} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--foreground)]">{labels.fieldStatus}</span>
        <Segmented label={labels.fieldStatus} options={STATUSES.map((value) => ({ value, title: labels.statusNames[value] }))} value={values.status} onChange={(status) => set({ status })} />
      </div>
      {form.error && <Alert variant="warm" title={form.error} className="w-full" />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={form.onCancel} disabled={form.busy}>
          {labels.cancel}
        </Button>
        <Button type="submit" loading={form.busy} disabled={form.busy}>
          {labels.save}
        </Button>
      </div>
    </form>
  );
}
