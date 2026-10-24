import { Alert, Badge, Button } from "./controls";
import { Dialog, Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@ykurilov/ds-react";
import type { FlowMigrateDialogProps } from "@ykurilov/agent-chat-flows/react";
import { useFlowLabels } from "@ykurilov/agent-chat-flows/react";
import { Select } from "./flow-parts";

/** Окно «Перевести чаты на новую версию»: версия → состояние → чатов, для удалённых состояний — куда перевести. */
export function OduvanchikFlowMigrateDialog(props: FlowMigrateDialogProps) {
  const labels = useFlowLabels().migrate;
  const nothing = !props.busy && props.rows.length === 0 && props.moved === null && !props.failed;
  return (
    <Dialog open title={labels.title} onClose={props.onClose}>
      <div className="oduvanchik-flow oduvanchik-flow-dialog">
        <p>{labels.hint}</p>
        {nothing && <p className="text-sm text-[var(--yk-muted)]">{labels.nothingToMigrate}</p>}
        {props.rows.length > 0 && (
          <div className="max-h-[50vh] overflow-auto">
            <Table className="w-full border-collapse text-sm">
              <TableHead>
                <TableRow className="text-left text-xs text-[var(--yk-muted)]">
                  <TableHeaderCell className="py-1.5 pr-2 font-medium">{labels.version}</TableHeaderCell>
                  <TableHeaderCell className="py-1.5 pr-2 font-medium">{labels.state}</TableHeaderCell>
                  <TableHeaderCell className="py-1.5 pr-2 text-right font-medium">{labels.chats}</TableHeaderCell>
                  <TableHeaderCell className="py-1.5 font-medium">{labels.target}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {props.rows.map((row) => (
                  <TableRow key={`${row.versionId}:${row.stateId}`} className="border-t border-[var(--yk-border)] align-middle">
                    <TableCell className="py-2 pr-2 font-mono text-xs text-[var(--yk-muted)]">{row.versionId}</TableCell>
                    <TableCell className="py-2 pr-2">
                      <span className="text-[var(--yk-text)]">{row.stateTitle}</span>
                      {row.removed && (
                        <Badge variant="warm" className="ml-1.5 py-0 text-[11px]">
                          {labels.removed}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-2 pr-2 text-right font-mono tabular-nums">{row.chats}</TableCell>
                    <TableCell className="py-2">
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
                        <span className="text-[var(--yk-muted)]">{row.stateTitle}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {props.moved !== null && <Alert variant="success" title={labels.moved(props.moved)} />}
        {props.failed && <Alert variant="danger" title={labels.failed} />}
        <footer className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {labels.close}
          </Button>
          <Button onClick={props.onMigrate} disabled={!props.canMigrate} loading={props.busy}>
            {labels.migrate}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
