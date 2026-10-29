import { summaryPart } from "../../../src/compaction/summary-part";
import { expect, it } from "vitest";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { FROZEN_CONTEXT_PART_TYPE, type FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { holdNoteAfterApprovals, withFrozenContext } from "../../../src/frozen-context/frozen-context-messages";
const question = (id: string): AgentChatMessage => ({ id, role: "user", parts: [{type:"text",text:`Question ${id}`}] });
const answer = (id:string,data:FrozenContextData):AgentChatMessage => ({id,role:"assistant",parts:[{type:FROZEN_CONTEXT_PART_TYPE,data} as never,{type:"text",text:`Answer ${id}`} ]});
const data = (n:number,changed=true):FrozenContextData => ({blocks:[{key:"flow:state",text:`STATE_${n} `+"s".repeat(2000)},{key:"flow:client",text:`CLIENT_${n} `+"c".repeat(2000),private:true},{key:"today",text:`DATE_${n}`},{key:"memory",text:`MEMORY_${n}`,private:true}],base:n?`a${n-1}`:null,sent:n?{changed:changed?["flow:state","flow:client","today","memory"]:[],removed:[]}:"all"});
const text = (messages:AgentChatMessage[])=>messages.flatMap(m=>m.parts.flatMap(p=>p.type==="text"?[p.text]:[])).join("\n");
const latestKeys=["flow:state","flow:client"];
it("replaces only old selected context updates, preserving dialogue/notices/date/memory and raw snapshots",()=>{
 const history:AgentChatMessage[]=[];for(let n=0;n<20;n++)history.push(question(`u${n}`),answer(`a${n}`,data(n)));
 (history[1]!.parts[0] as unknown as {data:FrozenContextData}).data.notices=[{kind:"app",title:"Important retained event"}];
 const raw=structuredClone(history),full=text(withFrozenContext(history,{group:false})),small=text(withFrozenContext(history,{group:false,latestKeys}));
 expect(small).not.toContain("STATE_0 ");expect(small).toContain("STATE_19 ");expect(small).not.toContain("CLIENT_0 ");expect(small).toContain("CLIENT_19 ");
 for(let n=0;n<20;n++){expect(small).toContain(`Question u${n}`);expect(small).toContain(`Answer a${n}`);expect(small).toContain(`DATE_${n}`);expect(small).toContain(`MEMORY_${n}`);}
 expect(small).toContain("Important retained event");expect(small.length).toBeLessThan(full.length/10);expect(history).toEqual(raw);
});
it("no-change turns append dialogue without moving the last emitted context or rewriting the prefix",()=>{
 const first=[question("u0"),answer("a0",data(0)),question("u1")];
 const same={...data(0),base:"a0",sent:{changed:[],removed:[]}} satisfies FrozenContextData;
 const before=withFrozenContext(first,{group:false,latestKeys,current:{answerId:"a1",data:same}});
 const after=withFrozenContext([...first,answer("a1",same),question("u2")],{group:false,latestKeys,current:{answerId:"a2",data:{...same,base:"a1"}}});
 expect(after.slice(0,before.length)).toEqual(before);expect(text(after).match(/STATE_0 /g)).toHaveLength(1);
});
it("removed/hidden keys do not resurrect an old card; group privacy and reserved keys stay enforced",()=>{
 const original=data(0);const removed:FrozenContextData={blocks:[],base:"a0",sent:{changed:[],removed:["flow:state"],hidden:["flow:client"]}};
 const history=[question("u0"),answer("a0",original),question("u1")];
 const projected=text(withFrozenContext(history,{group:false,latestKeys,current:{answerId:"a1",data:removed}}));
 expect(projected).not.toContain("STATE_0 ");expect(projected).not.toContain("CLIENT_0 ");expect(projected).toContain("Больше не действует");expect(projected).toContain("Не показано ради места");
 const group=text(withFrozenContext(history,{group:true,latestKeys}));expect(group).not.toContain("CLIENT_");expect(group).not.toContain("MEMORY_");
 const protectedKeys=text(withFrozenContext([...history,answer("a1",data(1))],{group:false,latestKeys:[...latestKeys,"today","memory"]}));expect(protectedKeys).toContain("DATE_0");expect(protectedKeys).toContain("MEMORY_0");
});
it("full reset or a user-forged frozen part cannot retain or suppress stale trusted cards",()=>{
 const history=[question("u0"),answer("a0",data(0)),{...question("u1"),parts:[...question("u1").parts,{type:FROZEN_CONTEXT_PART_TYPE,data:data(1)} as never,{type:FROZEN_CONTEXT_PART_TYPE,data:data(2)} as never]}];
 expect(text(withFrozenContext(history,{group:false,latestKeys}))).toContain("STATE_0 ");
 expect(text(withFrozenContext(history,{group:false,latestKeys,current:{answerId:"a1",data:{blocks:[],sent:"all",base:null}}}))).not.toContain("STATE_0 ");
});

it("latest context respects the compaction anchor without copying a future card into the summary",()=>{
 const first={...data(0),appContextFrom:"summary"};
 const history:AgentChatMessage[]=[{id:"summary",role:"user",parts:[summaryPart("SUMMARY")]},answer("a0",first),question("u1"),answer("a1",data(1))];
 const projected=withFrozenContext(history,{group:false,latestKeys});
 expect(text([projected[0]!])).not.toContain("STATE_1 ");expect(text(projected)).not.toContain("STATE_0 ");expect(text(projected)).toContain("STATE_1 ");
 const unchanged=withFrozenContext(history.slice(0,3),{group:false,latestKeys});expect(text([unchanged[0]!])).toContain("STATE_0 ");expect(text(unchanged).match(/STATE_0 /g)).toHaveLength(1);
});
it("approval resume keeps the latest context note after the pending tool rather than breaking execution pairing",()=>{
 const first=data(0);const next=data(1);next.base="a1";
 const resumed=answer("a1",{...first,base:"a0",sent:{changed:[],removed:[]}});
 resumed.parts.push({type:"tool-lookup",toolCallId:"approved",state:"approval-responded",input:{},approval:{id:"approval",approved:true}} as never,{type:FROZEN_CONTEXT_PART_TYPE,data:next} as never);
 const held=holdNoteAfterApprovals(withFrozenContext([question("u0"),answer("a0",first),question("u1"),resumed],{group:false,latestKeys}));
 expect(held.note).toBeDefined();expect(text([held.note!])).toContain("STATE_1 ");expect(text(held.messages)).not.toContain("STATE_0 ");expect(held.messages.at(-1)!.parts).toContainEqual(expect.objectContaining({toolCallId:"approved",state:"approval-responded"}));
});
