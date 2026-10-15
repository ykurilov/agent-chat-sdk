import { Alert, Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Switch } from "@tandem/ui";
import { useMcpLabels } from "@ykurilov/agent-chat-mcp/react";
import type { McpAdminScreenProps, McpCallRowView, McpServerCardView, McpServerStatus, McpToolRowView } from "@ykurilov/agent-chat-mcp/react";
import { Pencil, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { McpAddForm } from "./mcp-add-form";
import { McpEditForm } from "./mcp-edit-form";
import { Segmented } from "./segmented";

const STATUSES: McpServerStatus[] = ["off", "admins", "everyone"];

/** Инструмент: имя для модели, описание и два переключателя; нельзя включить — причина вместо переключателей. */
function ToolRow({ tool }: { tool: McpToolRowView }) {
  const labels = useMcpLabels();
  return (
    <li role="group" aria-label={tool.modelName} className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--border)] py-2.5 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-mono text-xs font-medium text-[var(--foreground)]">{tool.modelName}</span>
        {tool.readOnly && <Badge variant="neutral">{labels.readOnly}</Badge>}
      </div>
      {tool.description && <p className="line-clamp-2 break-words text-xs text-[var(--foreground-muted)]">{tool.description}</p>}
      {tool.problem ? (
        <p className="text-xs text-[var(--destructive-text)]">{labels.problems[tool.problem]}</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-[var(--foreground)]">
          <label className="flex items-center gap-2">
            <Switch checked={tool.enabled} disabled={tool.busy} onCheckedChange={tool.onEnabled} />
            {labels.toolEnabled}
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={tool.needsApproval} disabled={tool.busy} onCheckedChange={tool.onNeedsApproval} />
            {labels.toolNeedsApproval}
          </label>
        </div>
      )}
    </li>
  );
}

function CheckLine({ server }: { server: McpServerCardView }) {
  const labels = useMcpLabels();
  const check = server.lastCheck;
  if (!check) return null;
  const time = labels.time(check.at);
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      <p className={check.ok ? "text-[var(--foreground-muted)]" : "break-words text-[var(--destructive-text)]"}>
        {check.ok ? labels.lastCheckOk(time, check.toolCount ?? 0) : labels.lastCheckFailed(time, check.error ?? "")}
      </p>
      {check.ok && check.matchesSnapshot === false && <p className="text-[var(--foreground)]">{labels.snapshotDiffers}</p>}
    </div>
  );
}

/** Карточка сервера: адрес без секретов, кому доступен, связь, список инструментов; «Изменить» открывает форму правки. */
function ServerCard({ server }: { server: McpServerCardView }) {
  const labels = useMcpLabels();
  const [confirming, setConfirming] = useState(false);
  const busy = server.busy !== null;
  return (
    <li
      role="group"
      aria-label={server.name}
      data-server={server.prefix}
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-nested)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">{server.name}</h4>
            <Badge variant="neutral" className="font-mono">
              {server.prefix}
            </Badge>
          </div>
          <p className="min-w-0 break-all text-xs text-[var(--foreground-muted)]">
            {server.displayUrl}
            {server.urlHasHiddenParts && <span className="ml-1.5 italic">({labels.hiddenParts})</span>}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-[var(--foreground-muted)]">
            <span>{labels.transportNames[server.transport]}</span>
            {server.viaProxy && <span>{labels.viaProxy}</span>}
            {server.headerNames.map((name) => (
              <span key={name} className="font-mono">
                {labels.headerIsSet(name)}
              </span>
            ))}
          </p>
        </div>
        <Segmented
          label={labels.fieldStatus}
          options={STATUSES.map((value) => ({ value, title: labels.statusNames[value] }))}
          value={server.status}
          onChange={server.onStatus}
          disabled={busy}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" loading={server.busy === "check"} disabled={busy} onClick={server.onCheck}>
          <Wifi aria-hidden="true" className="size-3.5" />
          {labels.check}
        </Button>
        <Button variant="secondary" size="sm" loading={server.busy === "refresh"} disabled={busy} onClick={server.onRefresh}>
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {labels.refresh}
        </Button>
        {!server.edit.open && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={server.edit.onOpen}>
            <Pencil aria-hidden="true" className="size-3.5" />
            {labels.edit}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" className="size-3.5" />
          {labels.remove}
        </Button>
      </div>

      {server.edit.open && <McpEditForm server={server} />}
      <CheckLine server={server} />
      {server.error && (
        <p role="alert" className="break-words text-xs text-[var(--destructive-text)]">
          {server.error}
        </p>
      )}

      <section aria-label={labels.tools} className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">{labels.tools}</h5>
          {server.toolsUpdatedAt && <span className="text-xs text-[var(--foreground-muted)]">{labels.toolsUpdated(labels.time(server.toolsUpdatedAt))}</span>}
        </div>
        {server.tools.length === 0 ? (
          <p className="py-2 text-xs text-[var(--foreground-muted)]">{labels.noTools}</p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {server.tools.map((tool) => (
              <ToolRow key={tool.name} tool={tool} />
            ))}
          </ul>
        )}
      </section>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.confirmRemove}</DialogTitle>
          </DialogHeader>
          <p className="break-words px-1 text-sm text-[var(--foreground-muted)]">{server.name}</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                server.onRemove();
              }}
            >
              {labels.remove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/** Журнал вызовов: без входа и ответа инструмента. */
function CallJournal({ calls }: { calls: McpCallRowView[] }) {
  const labels = useMcpLabels();
  return (
    <section aria-label={labels.journal} className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{labels.journal}</h3>
      {calls.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">{labels.journalEmpty}</p>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[var(--radius-nested)] border border-[var(--border)]">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-[var(--surface-muted)] text-[var(--foreground-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">{labels.journalTime}</th>
                <th className="px-3 py-2 font-medium">{labels.journalTool}</th>
                <th className="px-3 py-2 font-medium">{labels.journalChat}</th>
                <th className="px-3 py-2 font-medium">{labels.journalDuration}</th>
                <th className="px-3 py-2 font-medium">{labels.journalResult}</th>
              </tr>
            </thead>
            <tbody className="bg-[var(--surface)] text-[var(--foreground)]">
              {calls.map((call) => (
                <tr key={call.id} className="border-t border-[var(--border)] align-top">
                  <td className="whitespace-nowrap px-3 py-2">{labels.time(call.startedAt)}</td>
                  <td className="px-3 py-2 font-mono">{call.toolName}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-[var(--foreground-muted)]">{call.chatId}</td>
                  <td className="whitespace-nowrap px-3 py-2">{labels.durationMs(call.durationMs)}</td>
                  <td className={call.ok ? "px-3 py-2 text-[var(--foreground-muted)]" : "break-words px-3 py-2 text-[var(--destructive-text)]"}>{call.ok ? labels.journalOk : call.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Экран «Серверы MCP»: серверы с инструментами, форма добавления, журнал вызовов. */
export function TandemMcpAdminScreen({ state, onRetry, servers, addForm, calls }: McpAdminScreenProps) {
  const labels = useMcpLabels();
  if (state === "not_found") return <p className="p-6 text-center text-sm text-[var(--foreground-muted)]">{labels.notFound}</p>;
  return (
    <section aria-label={labels.title} className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{labels.title}</h2>
          <p className="text-sm text-[var(--foreground-muted)]">{labels.intro}</p>
        </div>
        {state === "ready" && !addForm.open && (
          <Button size="sm" onClick={addForm.onOpen}>
            <Plus aria-hidden="true" className="size-4" />
            {labels.addServer}
          </Button>
        )}
      </header>
      {state === "loading" && <p className="text-sm text-[var(--foreground-muted)]">{labels.loading}</p>}
      {state === "failed" && (
        <Alert
          variant="warm"
          title={labels.failed}
          className="w-full"
          action={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {labels.retry}
            </Button>
          }
        />
      )}
      {state === "ready" && (
        <>
          {addForm.open && <McpAddForm form={addForm} />}
          {servers.length === 0 && !addForm.open ? (
            <p className="text-sm text-[var(--foreground-muted)]">{labels.empty}</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {servers.map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </ul>
          )}
          <CallJournal calls={calls} />
        </>
      )}
    </section>
  );
}
