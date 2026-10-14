import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tandem/ui";
import type { FlowMigrateDialogProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Select } from "./flow-parts";

/** Окно «Перевести чаты на новую версию»: версия → состояние → чатов, для удалённых состояний — куда перевести. */
export function TandemFlowMigrateDialog(props: FlowMigrateDialogProps) {
  const labels = useFlowLabels().migrate;
  const nothing = !props.busy && props.rows.length === 0 && props.moved === null && !props.failed;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="w-[min(640px,calc(100vw-24px))] max-w-none">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.hint}</DialogDescription>
        </DialogHeader>
        {nothing && <p className="text-sm text-[var(--foreground-muted)]">{labels.nothingToMigrate}</p>}
        {props.rows.length > 0 && (
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--foreground-subtle)]">
                  <th className="py-1.5 pr-2 font-medium">{labels.version}</th>
                  <th className="py-1.5 pr-2 font-medium">{labels.state}</th>
                  <th className="py-1.5 pr-2 text-right font-medium">{labels.chats}</th>
                  <th className="py-1.5 font-medium">{labels.target}</th>
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => (
                  <tr key={`${row.versionId}:${row.stateId}`} className="border-t border-[var(--border)] align-middle">
                    <td className="py-2 pr-2 font-mono text-xs text-[var(--foreground-muted)]">{row.versionId}</td>
                    <td className="py-2 pr-2">
                      <span className="text-[var(--foreground)]">{row.stateTitle}</span>
                      {row.removed && (
                        <Badge variant="warm" className="ml-1.5 py-0 text-[11px]">
                          {labels.removed}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.chats}</td>
                    <td className="py-2">
                      {row.removed ? (
                        <Select aria-label={labels.target} value={row.target ?? ""} onChange={(event) => row.onTargetChange(event.target.value)}>
                          <option value="" disabled>
                            {labels.chooseTarget}
                          </option>
                          {props.targets.map((target) => (
                            <option key={target.value} value={target.value}>
                              {target.title}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-[var(--foreground-subtle)]">{row.stateTitle}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {props.moved !== null && <Alert variant="success" title={labels.moved(props.moved)} />}
        {props.failed && <Alert variant="danger" title={labels.failed} />}
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            {labels.close}
          </Button>
          <Button onClick={props.onMigrate} disabled={!props.canMigrate} loading={props.busy}>
            {labels.migrate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
