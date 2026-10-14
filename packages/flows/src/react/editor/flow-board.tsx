import {
  Background,
  BackgroundVariant,
  getBezierPath,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ANY_STATE_LAYOUT_KEY, RETURN_TARGET, type AgentFlow, type FlowCatalog, type FlowExit, type FlowIssue, type FlowPoint } from "../../format/flow-format";
import { activeExits, isFinal, stateById } from "../../engine/flow-graph";
import type { FlowEditorLabels } from "../../labels/editor";
import { useFlowLabels } from "../flow-labels";
import type {
  FlowAnyStateNodeProps,
  FlowEdgeKind,
  FlowEdgeProps,
  FlowEditorSkin,
  FlowExitRowView,
  FlowIssueCount,
  FlowStateNodeProps,
  FlowBoardToggleProps,
} from "../flow-editor-skin";
import type { BoardSpace } from "./board-space";
import { FLOW_BOARD_CSS } from "./board-styles";
import { addExit, connectExit, placeNode, type ExitOwner } from "./editor-model";
import { conditionText, edgeKind, stateGoal, targetTitle } from "./exit-text";
import { stateTimingText } from "./schedule-model";
import { simulationChoices } from "./flow-simulation";
import type { FlowEditorController } from "./use-flow-editor";

// Доска: узлы и стрелки `@xyflow/react`, нарисованные частями скина. Здесь — только раскладка, ручки, пути стрелок и
// жесты; что показать в узле, считает этот модуль из сценария, правки уходят в `useFlowEditor`.

/** Ручка «новое условие» у каждого узла: потянуть — появится условие словами. */
export const NEW_EXIT_HANDLE = "@new";
const INPUT_HANDLE = "in";

const LEGEND_KINDS: FlowEdgeKind[] = ["judge", "data", "event", "timer", "return"];

type StateNodeData = { view: Omit<FlowStateNodeProps, "renderInputHandle" | "renderExitHandle">; draggable: boolean };
type AnyNodeData = { view: Omit<FlowAnyStateNodeProps, "renderExitHandle">; draggable: boolean };
type FlowEdgeData = Omit<FlowEdgeProps, "edgeId" | "path" | "labelX" | "labelY">;

type StateNode = Node<StateNodeData, "state">;
type AnyNode = Node<AnyNodeData, "any">;
type BoardNode = StateNode | AnyNode;
type BoardEdge = Edge<FlowEdgeData, "flow">;

const SkinContext = createContext<FlowEditorSkin | null>(null);

function useSkin(): FlowEditorSkin {
  const skin = useContext(SkinContext);
  if (!skin) throw new Error("FlowBoard renders only inside FlowEditor.");
  return skin;
}

function exitHandle(exitId: string, connectable: boolean): ReactNode {
  return <Handle type="source" position={Position.Right} id={exitId} isConnectable={connectable} />;
}

function StateNodeView({ data }: NodeProps<StateNode>) {
  const skin = useSkin();
  return (
    <>
      <skin.FlowStateNode
        {...data.view}
        renderInputHandle={() => <Handle type="target" position={Position.Left} id={INPUT_HANDLE} isConnectable={data.draggable} />}
        renderExitHandle={(exitId) => exitHandle(exitId, data.draggable)}
      />
      {data.draggable ? <Handle type="source" position={Position.Right} id={NEW_EXIT_HANDLE} className="flow-board__new-exit" /> : null}
    </>
  );
}

function AnyNodeView({ data }: NodeProps<AnyNode>) {
  const skin = useSkin();
  return (
    <>
      <skin.FlowAnyStateNode {...data.view} renderExitHandle={(exitId) => exitHandle(exitId, data.draggable)} />
      {data.draggable ? <Handle type="source" position={Position.Right} id={NEW_EXIT_HANDLE} className="flow-board__new-exit" /> : null}
    </>
  );
}

function EdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<BoardEdge>) {
  const skin = useSkin();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!data) return null;
  return <skin.FlowEdge {...data} edgeId={id} path={path} labelX={labelX} labelY={labelY} />;
}

const nodeTypes = { state: StateNodeView, any: AnyNodeView };
const edgeTypes = { flow: EdgeView };

/** Место узла: из `layout`, а без него — сетка по порядку состояний. */
function nodePosition(flow: AgentFlow, nodeId: string, index: number): FlowPoint {
  const saved = flow.layout[nodeId];
  if (saved) return saved;
  if (nodeId === ANY_STATE_LAYOUT_KEY) return { x: 40, y: -220 };
  return { x: 40 + (index % 4) * 330, y: 40 + Math.floor(index / 4) * 260 };
}

function countFor(issues: FlowIssue[], match: (issue: FlowIssue) => boolean): FlowIssueCount {
  const found = issues.filter(match);
  return { errors: found.filter((issue) => issue.level === "error").length, warnings: found.filter((issue) => issue.level === "warning").length };
}

function exitRows(flow: AgentFlow, catalog: FlowCatalog, exits: FlowExit[], issues: FlowIssue[], labels: FlowEditorLabels): FlowExitRowView[] {
  return exits.map((exit) => ({
    exitId: exit.id,
    kind: edgeKind(exit),
    text: conditionText(flow, exit.when, labels, catalog),
    target: targetTitle(flow, exit.to, labels),
    issues: countFor(issues, (issue) => issue.place.exitId === exit.id),
  }));
}

const ownerOf = (nodeId: string): ExitOwner => (nodeId === ANY_STATE_LAYOUT_KEY ? null : nodeId);

/** Что подсветить в прогоне: где агент, где был, куда можно пойти, по каким стрелкам прошли. */
function runMarks(editor: FlowEditorController) {
  const sim = editor.simulation;
  if (editor.mode !== "run" || !sim) return null;
  const visited = new Set(sim.steps.map((step) => step.stateId));
  const next = new Set(simulationChoices(editor.flow, sim).flatMap((choice) => (choice.target ? [choice.target] : [])));
  const traversed = new Set(sim.steps.flatMap((step) => (step.exitId ? [step.exitId] : [])));
  const state = stateById(editor.flow, sim.run.state);
  const live = new Set(state ? activeExits(editor.flow, state).map(({ exit }) => exit.id) : []);
  return { current: sim.run.state, visited, next, traversed, live };
}

function useBoardModel(editor: FlowEditorController) {
  const labels = useFlowLabels().editor;
  const { flow, catalog, issues, selection, mode, select, readOnly } = editor;
  return useMemo(() => {
    const marks = runMarks(editor);
    // Выбирать ноду и стрелку можно вне прогона; двигать и соединять — ещё и не в режиме «только просмотр».
    const selectable = mode !== "run";
    const editable = selectable && !readOnly;
    const selectedExit = selection.kind === "state" || selection.kind === "any" ? selection.exitId : undefined;

    const nodes: BoardNode[] = flow.states.map((state, index) => ({
      id: state.id,
      type: "state",
      position: nodePosition(flow, state.id, index),
      draggable: editable,
      data: {
        draggable: editable,
        view: {
          stateId: state.id,
          title: state.title || state.id,
          goal: stateGoal(state.instructions),
          exits: exitRows(flow, catalog, state.exits, issues, labels),
          tags: state.tags,
          start: flow.start === state.id,
          final: isFinal(state),
          noSideQuestions: state.noSideQuestions,
          timing: stateTimingText(flow, state, labels),
          selected: selection.kind === "state" && selection.stateId === state.id,
          dimmed: marks !== null && !marks.visited.has(state.id) && !marks.next.has(state.id),
          run: marks === null ? null : marks.current === state.id ? "current" : marks.visited.has(state.id) ? "visited" : null,
          issues: countFor(issues, (issue) => issue.place.stateId === state.id),
          onSelect: () => selectable && select({ kind: "state", stateId: state.id }),
        },
      },
    }));
    if (flow.anyState.exits.length > 0 || flow.anyState.except.length > 0 || flow.layout[ANY_STATE_LAYOUT_KEY]) {
      nodes.push({
        id: ANY_STATE_LAYOUT_KEY,
        type: "any",
        position: nodePosition(flow, ANY_STATE_LAYOUT_KEY, 0),
        draggable: editable,
        data: {
          draggable: editable,
          view: {
            except: flow.anyState.except.map((id) => stateById(flow, id)?.title ?? id),
            exits: exitRows(flow, catalog, flow.anyState.exits, issues, labels),
            selected: selection.kind === "any",
            dimmed: marks !== null,
            issues: countFor(issues, (issue) => !issue.place.stateId && flow.anyState.exits.some((exit) => exit.id === issue.place.exitId)),
            onSelect: () => selectable && select({ kind: "any" }),
          },
        },
      });
    }

    const owners: Array<{ nodeId: string; exits: FlowExit[] }> = [
      { nodeId: ANY_STATE_LAYOUT_KEY, exits: flow.anyState.exits },
      ...flow.states.map((state) => ({ nodeId: state.id, exits: state.exits })),
    ];
    const edges: BoardEdge[] = owners.flatMap(({ nodeId, exits }) =>
      exits
        .filter((exit) => exit.to !== null && exit.to !== RETURN_TARGET && stateById(flow, exit.to))
        .map((exit) => ({
          id: `${nodeId}:${exit.id}`,
          type: "flow" as const,
          source: nodeId,
          sourceHandle: exit.id,
          target: exit.to!,
          targetHandle: INPUT_HANDLE,
          data: {
            kind: edgeKind(exit),
            label: conditionText(flow, exit.when, labels, catalog),
            selected: selectedExit === exit.id,
            dimmed: marks !== null && !marks.traversed.has(exit.id) && !(marks.live.has(exit.id) && nodeId === marks.current),
            traversed: marks?.traversed.has(exit.id) ?? false,
            onSelect: () =>
              selectable && select(nodeId === ANY_STATE_LAYOUT_KEY ? { kind: "any", exitId: exit.id } : { kind: "state", stateId: nodeId, exitId: exit.id }),
          },
        })),
    );
    return { nodes, edges };
    // `editor` целиком меняется на каждом рендере; от прогона берём `simulation` и `mode`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, catalog, issues, selection, mode, readOnly, editor.simulation, labels, select]);
}

/** Кнопка места на доске: у скина своя (`FlowBoardToggle`), без неё — простая на токенах `--flow-board-*`. */
function BoardToggle(props: FlowBoardToggleProps) {
  const skin = useSkin();
  if (skin.FlowBoardToggle) return <skin.FlowBoardToggle {...props} />;
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-expanded={props.expanded}
      data-flow-board-toggle={props.kind}
      onClick={props.onClick}
      style={{
        font: "inherit",
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 8,
        cursor: "pointer",
        color: "inherit",
        background: "var(--flow-board-handle-fill, #fff)",
        border: "1px solid var(--flow-board-handle, currentColor)",
      }}
    >
      {props.showText ? props.label : props.kind === "legend" ? "?" : props.expanded ? "×" : "+"}
    </button>
  );
}

/** Кнопки масштаба скина: ведут доску через `useReactFlow`. */
function ZoomControls() {
  const skin = useSkin();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((store) => store.transform[2]);
  return (
    <skin.FlowZoomControls
      zoom={zoom}
      onZoomIn={() => void zoomIn({ duration: 150 })}
      onZoomOut={() => void zoomOut({ duration: 150 })}
      onFit={() => void fitView({ duration: 200, padding: 0.15 })}
    />
  );
}

function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}

const ignoreNodeClick = () => {};

function Board({ editor, space }: { editor: FlowEditorController; space: BoardSpace }) {
  const spaceLabels = useFlowLabels().editor.board.space;
  const skin = useSkin();
  const model = useBoardModel(editor);
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = useState<BoardNode[]>(model.nodes);

  // Узлы из сценария, но размеры (их меряет доска) и место во время перетаскивания — свои.
  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return model.nodes.map((node) => {
        const old = byId.get(node.id);
        if (!old) return node;
        return { ...node, measured: old.measured, ...(old.dragging ? { position: old.position, dragging: true } : {}) } as BoardNode;
      });
    });
  }, [model.nodes]);

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => setNodes((current) => applyNodeChanges(changes, current)), []);

  const { edit, connect, connectToNewState, select } = editor;

  const onConnect = useCallback(
    (connection: Connection) => {
      const owner = ownerOf(connection.source);
      if (connection.target === ANY_STATE_LAYOUT_KEY) return;
      if (connection.sourceHandle === NEW_EXIT_HANDLE || !connection.sourceHandle) {
        edit((flow) => {
          const made = addExit(flow, owner, "judge");
          return connectExit(made.flow, owner, made.exitId, connection.target);
        });
        return;
      }
      connect(owner, connection.sourceHandle, connection.target);
    },
    [connect, edit],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return;
      const owner = ownerOf(state.fromNode.id);
      const exitId = state.fromHandle.id === NEW_EXIT_HANDLE ? null : (state.fromHandle.id ?? null);
      // Отпустили на узле мимо ручки — всё равно соединяем с ним.
      if (state.toNode && state.toNode.id !== ANY_STATE_LAYOUT_KEY) {
        onConnect({ source: state.fromNode.id, sourceHandle: exitId ?? NEW_EXIT_HANDLE, target: state.toNode.id, targetHandle: INPUT_HANDLE });
        return;
      }
      const point = clientPoint(event);
      if (!point) return;
      const at = screenToFlowPosition(point);
      connectToNewState(owner, exitId, { x: Math.round(at.x), y: Math.round(at.y - 40) });
    },
    [connectToNewState, onConnect, screenToFlowPosition],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: BoardNode) => edit((flow) => placeNode(flow, node.id, node.position)),
    [edit],
  );

  const selectable = editor.mode !== "run";
  const editable = selectable && !editor.readOnly;
  return (
    <ReactFlow<BoardNode, BoardEdge>
      nodes={nodes}
      edges={model.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onNodeDragStop={onNodeDragStop}
      // Без перетаскивания и связей (только просмотр) доска отключает клики по узлам, если нет обработчика: нужен хотя бы пустой.
      onNodeClick={ignoreNodeClick}
      onPaneClick={() => selectable && select({ kind: "overview" })}
      nodesConnectable={editable}
      elementsSelectable={false}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      {!space.legendHidden && (
        <Panel position="bottom-left" className="flow-board__legend">
          <div className="flow-board__legend-stack" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
            {space.legendOpen && <skin.FlowLegend kinds={LEGEND_KINDS} />}
            <BoardToggle kind="legend" label={spaceLabels.legend} expanded={space.legendOpen} showText onClick={space.toggleLegend} />
          </div>
        </Panel>
      )}
      {space.inspectorToggleable && (
        <Panel position="top-right">
          <BoardToggle
            kind="inspector"
            label={space.inspectorOpen ? spaceLabels.hideInspector : spaceLabels.showInspector}
            expanded={space.inspectorOpen}
            onClick={space.toggleInspector}
          />
        </Panel>
      )}
      <Panel position="bottom-right">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!space.minimapHidden && (
            <span className="flow-board__minimap-toggle" style={{ display: "contents" }}>
              <BoardToggle
                kind="minimap"
                label={space.minimapOpen ? spaceLabels.hideMinimap : spaceLabels.showMinimap}
                expanded={space.minimapOpen}
                onClick={space.toggleMinimap}
              />
            </span>
          )}
          <ZoomControls />
        </div>
      </Panel>
      {space.minimapOpen && <MiniMap className="flow-board__minimap" pannable zoomable position="bottom-right" style={{ marginBottom: 76 }} />}
    </ReactFlow>
  );
}

/** Доска редактора. Свой `ReactFlowProvider`: другой сценарий — доска заново и «весь граф» в экран. */
export function FlowBoard({ editor, skin, space }: { editor: FlowEditorController; skin: FlowEditorSkin; space: BoardSpace }) {
  return (
    <SkinContext.Provider value={skin}>
      <style>{FLOW_BOARD_CSS}</style>
      <ReactFlowProvider key={editor.flow.id}>
        <Board editor={editor} space={space} />
      </ReactFlowProvider>
    </SkinContext.Provider>
  );
}
