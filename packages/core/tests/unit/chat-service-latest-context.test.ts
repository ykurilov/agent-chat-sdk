import { expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { callTool, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";
import { finishPart, readAll, streamStart } from "./support/mock-model";
import { FROZEN_CONTEXT_PART_TYPE } from "../../src/frozen-context/context-blocks";
async function conversation(compact:boolean){
 let turn=0;const model=scriptedModel();const {service,storage}=noticeService(model,{agent:{contextBlocks:()=>[{key:"flow:state",text:`STATE_${++turn} `+"state ".repeat(400)},{key:"flow:client",text:`CLIENT_${turn} `+"client ".repeat(400),private:true}],...(compact&&{contextBlocksHistory:{latest:["flow:state","flow:client"]}})}});
 const chat=await service.createChat("owner");for(let n=0;n<10;n++)await readAll(await service.sendMessage("owner",chat.id,userMessage(`u${n}`,`User ${n}`)));
 return {wire:JSON.stringify(model.doStreamCalls.at(-1)!.prompt),stored:await storage.listMessages(chat.id)};
}
it("opt-in reduces the real model request while all old cards remain raw in storage",async()=>{
 const full=await conversation(false),compact=await conversation(true);
 expect(compact.wire).not.toContain("STATE_1 ");expect(compact.wire).toContain("STATE_10 ");expect(compact.wire).not.toContain("CLIENT_1 ");expect(compact.wire).toContain("CLIENT_10 ");
 for(let n=0;n<10;n++)expect(compact.wire).toContain(`User ${n}`);
 expect(compact.wire.length).toBeLessThan(full.wire.length/5);
 const snapshots=compact.stored.flatMap(m=>m.parts.filter(p=>p.type===FROZEN_CONTEXT_PART_TYPE));expect(snapshots).toHaveLength(10);expect(JSON.stringify(snapshots)).toContain("STATE_1 ");
 console.log(JSON.stringify({fixture:"10 changing state/client context cards",fullBytes:Buffer.byteLength(full.wire),latestBytes:Buffer.byteLength(compact.wire),rawSnapshots:snapshots.length}));
});

it.each(["send", "regenerate", "edit", "retry-empty"] as const)("%s reads the latest card for a new answer without rewriting the previous snapshot", async (action) => {
 const model=scriptedModel(action === "retry-empty" ? [[streamStart, finishPart()]] : []);
 let rule="OLD_CARD";
 const source=vi.fn(()=>[{key:"flow:state",text:rule}]);
 const {service,storage}=noticeService(model,{agent:{contextBlocks:source,contextBlocksHistory:{latest:["flow:state"]}}});
 const chat=await service.createChat("owner");
 await readAll(await service.sendMessage("owner",chat.id,userMessage("u1","First question")));
 const previous=(await storage.listMessages(chat.id)).findLast(m=>m.role==="assistant")!;
 const oldParts=structuredClone(previous.parts);
 rule="NEW_CARD";
 if(action==="send")await readAll(await service.sendMessage("owner",chat.id,userMessage("u2","Next question")));
 if(action==="regenerate")await readAll(await service.regenerate("owner",chat.id,previous.id));
 if(action==="edit")await readAll(await service.editMessage("owner",chat.id,"u1",userMessage("edited","Edited question")));
 if(action==="retry-empty")await readAll(await service.retry("owner",chat.id));
 expect(source).toHaveBeenCalledTimes(2);
 const request=JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
 expect(request).toContain("NEW_CARD");expect(request).not.toContain("OLD_CARD");
 expect((await storage.getMessage(previous.id))!.parts).toEqual(oldParts);
 expect(JSON.stringify(oldParts)).toContain("OLD_CARD");
});

it("retry of interrupted tool steps preserves the frozen card and does not execute the tool again",async()=>{
 const model=scriptedModel([callTool("read","read-1"),[streamStart,{type:"error",error:new Error("provider failed")}],saying("continued")]);
 let rule="OLD_CARD";
 const source=vi.fn(()=>[{key:"flow:state",text:rule}]);
 const execute=vi.fn(async()=>"read result");
 const {service}=noticeService(model,{agent:{contextBlocks:source,contextBlocksHistory:{latest:["flow:state"]},tools:{read:tool({description:"read",inputSchema:z.object({}),execute})}}});
 const chat=await service.createChat("owner");
 await readAll(await service.sendMessage("owner",chat.id,userMessage("u1","Read")));
 rule="NEW_CARD";
 await readAll(await service.retry("owner",chat.id));
 expect(source).toHaveBeenCalledTimes(1);expect(execute).toHaveBeenCalledTimes(1);
 const request=JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
 expect(request).toContain("OLD_CARD");expect(request).not.toContain("NEW_CARD");
});
