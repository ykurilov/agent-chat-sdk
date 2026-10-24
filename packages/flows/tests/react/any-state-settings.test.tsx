// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ANY_STATE_LAYOUT_KEY, parseFlow, type AgentFlow } from "../../src/format";
import { FlowEditor, FlowTestChat, type FlowEditorSkin } from "../../src/react";
import { addExit, moveExit, removeExit, freeSpot, flowToJson } from "../../src/react/editor/editor-model";
import { useFlowEditor } from "../../src/react/editor/use-flow-editor";
import sales from "../fixtures/sales-review.json";
const captured=vi.hoisted(()=>({nodes:[] as {id:string}[],edges:[] as {source:string}[]}));
vi.mock("@xyflow/react",async()=>({...(await vi.importActual<object>("@xyflow/react")),
 ReactFlow:({nodes,edges,children}:{nodes:typeof captured.nodes;edges:typeof captured.edges;children:ReactNode})=>{captured.nodes=nodes;captured.edges=edges;return <div>{children}</div>;},
 ReactFlowProvider:({children}:{children:ReactNode})=>children,
 useReactFlow:()=>({screenToFlowPosition:vi.fn(),zoomIn:vi.fn(),zoomOut:vi.fn(),fitView:vi.fn()}),
 useStore:(select:(state:{transform:number[]})=>unknown)=>select({transform:[0,0,1]}),
 Panel:({children}:{children:ReactNode})=><div>{children}</div>,MiniMap:()=>null,Background:()=>null,
}));
afterEach(()=>{cleanup();window.localStorage.clear();});
const parsed=parseFlow(sales);if(!parsed.ok)throw Error("fixture");const flow=parsed.flow;
const catalog={tools:["finish_dialog","give_booking_link","call_expert"],events:["booking_link"],widgets:[]};
const none=()=>null;
const skin={FlowEditorFrame:({header,board,panel})=><>{header}{board}<aside>{panel}</aside></>,
 FlowHeader:(props)=><><button onClick={(props as typeof props&{onOpenAnyState?():void}).onOpenAnyState}>Common settings</button><button onClick={()=>props.onModeChange("check")}>Check</button><button onClick={()=>void props.onSave?.()}>Save</button>{props.onOpenTestChat&&<button onClick={props.onOpenTestChat}>Open test chat</button>}</>,
 FlowStateNode:none,FlowAnyStateNode:none,FlowEdge:none,FlowLegend:none,FlowZoomControls:none,
 FlowBoardToggle:props=><button onClick={props.onClick}>{props.kind}</button>,
 FlowOverviewPanel:props=><section>Overview{props.sections}</section>,FlowStatePanel:none,
 FlowAnyStatePanel:props=><section aria-label="Common settings panel">{props.exits}<button onClick={()=>props.onExceptChange(["intro"])}>Exclude intro</button></section>,
 FlowExitCard:props=><article><button onClick={()=>props.onChange({when:{type:"event",event:"tool",name:"finish_dialog"},to:"booked"})}>Edit {props.exitId}</button></article>,
 FlowTestChatFrame:props=><section aria-label="Test chat panel">{props.children}</section>,
 FlowCardPanel:none,FlowFieldRow:none,FlowCheckPanel:props=><>{props.issues.map((issue,index)=><button key={index} onClick={issue.onGo}>{issue.message}</button>)}</>,FlowRunPanel:none,FlowJsonDialog:none,FlowMigrateDialog:none,
} satisfies FlowEditorSkin;
it("board nodes and edges only describe states even with legacy global layout",()=>{
 const legacy={...flow,layout:{...flow.layout,[ANY_STATE_LAYOUT_KEY]:{x:-9999,y:9999}}};
 render(<FlowEditor value={legacy} onChange={()=>{}} catalog={catalog} skin={skin}/>);
 expect(captured.nodes.map(n=>n.id)).toEqual(flow.states.map(s=>s.id));
 expect(captured.edges.some(e=>e.source===ANY_STATE_LAYOUT_KEY)).toBe(false);
 expect(captured.edges.length).toBeGreaterThan(0);
 expect(freeSpot(legacy)).toEqual(freeSpot(flow));
 expect(JSON.parse(flowToJson(legacy)).layout[ANY_STATE_LAYOUT_KEY]).toEqual({x:-9999,y:9999});
});
it("explicit common settings reopen after collapse and edit the same persisted JSON",async()=>{
 let current=flow;const save=vi.fn(async()=>({ok:true as const}));
 function App(){const[value,setValue]=useState(flow);current=value;return <FlowEditor value={value} onChange={setValue} catalog={catalog} skin={skin} inspector="collapsible" onSave={save}/>;}
 render(<App/>);fireEvent.click(screen.getByText("Common settings"));expect(screen.getByRole("region",{name:"Common settings panel"})).toBeTruthy();
 fireEvent.click(screen.getByText("inspector"));expect(screen.queryByRole("region",{name:"Common settings panel"})).toBeNull();
 fireEvent.click(screen.getByText("Common settings"));expect(screen.getByRole("region",{name:"Common settings panel"})).toBeTruthy();
 // Kind switch normalizes its fields first, then the event controls choose tool/name.
 fireEvent.click(screen.getByText("Edit "+flow.anyState.exits[0]!.id));fireEvent.click(screen.getByText("Edit "+flow.anyState.exits[0]!.id));fireEvent.click(screen.getByText("Exclude intro"));
 const restored=parseFlow(JSON.parse(flowToJson(current)));expect(restored.ok).toBe(true);if(!restored.ok)return;
 expect(restored.flow.anyState).toEqual({except:["intro"],exits:[{id:flow.anyState.exits[0]!.id,when:{type:"event",event:"tool",name:"finish_dialog"},to:"booked"}]});
 expect(restored.flow.states).toEqual(flow.states);
 await act(async()=>fireEvent.click(screen.getByText("Save")));expect(save).toHaveBeenCalledWith(current);
});
it("unknown except-state validation navigates to global settings rather than overview",()=>{
 const{result}=renderHook(()=>useFlowEditor({value:{...flow,anyState:{...flow.anyState,except:["missing"]}},onChange:()=>{},catalog}));
 const issue=result.current.issues.find(i=>i.code==="unknown_except_state")!;expect(issue).toBeTruthy();
 act(()=>result.current.goToIssue(issue));expect(result.current.selection).toEqual({kind:"any"});
});

it("an exit validation action opens common settings and focuses the affected rule",()=>{
 render(<FlowEditor value={flow} onChange={()=>{}} catalog={catalog} skin={skin} inspector="collapsible" checks={()=>[{path:"anyState.exits[0]",message:"Rule issue"}]}/>);
 fireEvent.click(screen.getByText("Check"));fireEvent.click(screen.getByText("Rule issue"));
 expect(document.activeElement?.getAttribute("data-flow-exit-focus")).toBe(flow.anyState.exits[0]!.id);
 fireEvent.click(screen.getByText("inspector"));fireEvent.click(screen.getByText("Check"));fireEvent.click(screen.getByText("Rule issue"));
 expect(screen.getByRole("region",{name:"Common settings panel"})).toBeTruthy();
 expect(document.activeElement?.getAttribute("data-flow-exit-focus")).toBe(flow.anyState.exits[0]!.id);
});

it("readOnly keeps the common settings entry available and blocks mutations",()=>{
 const change=vi.fn();render(<FlowEditor value={flow} onChange={change} catalog={catalog} skin={skin} inspector="collapsible" readOnly/>);
 fireEvent.click(screen.getByText("Common settings"));const edit=screen.getByText("Edit "+flow.anyState.exits[0]!.id);
 expect(edit.matches(":disabled")).toBe(true);fireEvent.click(edit);fireEvent.click(screen.getByText("Exclude intro"));expect(change).not.toHaveBeenCalled();
});

it("global rule add/order/delete roundtrips without changing state exits or legacy layout",()=>{
 const first=addExit(flow,null,"event");const second=addExit(first.flow,null,"judge");
 const ordered=moveExit(second.flow,null,second.exitId,-1);
 expect(ordered.anyState.exits.map(e=>e.id)).toEqual([flow.anyState.exits[0]!.id,second.exitId,first.exitId]);
 const removed=removeExit(ordered,null,first.exitId);const json=JSON.parse(flowToJson(removed));const restored=parseFlow(json);expect(restored.ok).toBe(true);if(!restored.ok)return;
 expect(restored.flow.anyState.exits.map(e=>e.id)).toEqual([flow.anyState.exits[0]!.id,second.exitId]);
 expect(restored.flow.anyState.except).toEqual(flow.anyState.except);expect(restored.flow.states).toEqual(flow.states);expect(restored.flow.layout).toEqual(flow.layout);
});

it("FlowTestChat common settings replace the open test panel without resetting its chat in locked mode",async()=>{
 const start=vi.fn(async()=>({chatId:"synthetic"}));const change=vi.fn();
 const connection={start,advance:async()=>({timeOffset:0}),readRun:async()=>({state:"intro",path:[]}),renderChat:()=> <p>Synthetic chat</p>};
 render(<FlowTestChat value={flow} onChange={change} catalog={catalog} skin={skin} inspector="collapsible" readOnly testChat={connection}/>);
 fireEvent.click(screen.getByText("Open test chat"));await screen.findByText("Synthetic chat");
 fireEvent.click(screen.getByText("Common settings"));await waitFor(()=>expect(screen.queryByRole("region",{name:"Test chat panel"})).toBeNull());
 const settings=screen.getByRole("region",{name:"Common settings panel"});expect(settings).toBeTruthy();expect(screen.getByText("Edit "+flow.anyState.exits[0]!.id).matches(":disabled")).toBe(true);
 fireEvent.click(screen.getByText("Open test chat"));await screen.findByText("Synthetic chat");expect(start).toHaveBeenCalledTimes(1);expect(change).not.toHaveBeenCalled();
});
