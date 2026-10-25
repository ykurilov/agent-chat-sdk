import type { UIMessageChunk } from "ai";
import {afterEach,expect,it,vi} from "vitest";
import {createAnswerSaver} from "../../../src/agent-run/answer-saver";
import type {AgentChatMessage} from "../../../src/conversation/types";
import type {ChatStorage} from "../../../src/storage/chat-storage";

afterEach(()=>vi.useRealTimers());
it("сохранённый фрагмент аргументов не разрешает действие с ещё не записанным полным вводом",async()=>{
 vi.useFakeTimers();
 let fail=false;
 const written:AgentChatMessage["parts"][]=[];
 const storage={
  updateStreamingMessage:async(_id:string,patch:{parts:AgentChatMessage["parts"]})=>{
   if(fail)throw new Error("write refused");
   written.push(structuredClone(patch.parts));
  },
  markAnswerAlive:async()=>{},
 } as unknown as ChatStorage;
 const saver=createAnswerSaver(storage,"a1",()=>({}),()=>null,()=>{});
 for(const chunk of [
  {type:"start",messageId:"a1"},
  {type:"start-step"},
  {type:"tool-input-start",toolCallId:"c1",toolName:"effect"},
  {type:"tool-input-delta",toolCallId:"c1",inputTextDelta:'{"recipient":"fir'},
 ] as UIMessageChunk[])saver.observe(chunk);
 try{
  await vi.advanceTimersByTimeAsync(500);
  expect(written.at(-1)?.find(p=>p.type==="tool-effect")).toMatchObject({state:"input-streaming"});
  fail=true;
  const result=saver.whenCallSaved("c1").then(()=>"saved",()=>"refused");
  saver.observe({type:"tool-input-available",toolCallId:"c1",toolName:"effect",input:{recipient:"first"}});
  await vi.advanceTimersByTimeAsync(0);
  expect(await result).toBe("refused");
 }finally{saver.stop();}
});
