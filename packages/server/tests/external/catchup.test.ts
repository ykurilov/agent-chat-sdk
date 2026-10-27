import { expect, it, vi } from "vitest";
import { createExternalConversationService, createMemoryConversationStore, type ConversationFeedEvent } from "@ykurilov/agent-chat-core/external";
import { createExternalChatHandler } from "../../src/external";

it("replays 100 committed events after a cursor in less than one second with the default poll interval", async () => {
  const service = createExternalConversationService({ store: createMemoryConversationStore(), resolveExecutor: () => { throw Error("offline"); } });
  await service.ensureConversation({ id: "main", ownerId: "owner", title: "Main", execution: { kind: "external", id: "manager" } });
  for (let i = 0; i < 7; i++) await service.send("owner", "main", { clientMessageId: `before-${i}`, text: "Before" });
  const after = (await service.snapshot("owner", "main")).cursor;
  for (let i = 0; i < 100; i++) await service.send("owner", "main", { clientMessageId: `after-${i}`, text: `Message ${i}` });
  const handler = createExternalChatHandler({ service, resolveUser: () => ({ id: "owner" }) });
  const started = performance.now();
  const response = await handler.fetch(new Request(`https://chat.example.com/api/conversations/main/events?after=${after}`, { headers: { accept: "text/event-stream" } }));
  const reader = response.body!.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ids = await Promise.race([
      (async () => {
        let text = "";
        while ((text.match(/^id: /gm) ?? []).length < 100) {
          const next = await reader.read();
          if (next.done) throw Error("Unexpected EOF");
          text += new TextDecoder().decode(next.value);
        }
        return [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("100 events exceeded one second")), 1000); }),
    ]);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, index) => after + index + 1));
    const elapsed = performance.now() - started;
    console.info("SSE_CATCHUP_MS", elapsed);
    expect(elapsed).toBeLessThan(1000);
  } finally { clearTimeout(timer); await reader.cancel(); await service.close(); }
});


it("pull resumes a byte-bounded backlog immediately, including a paginated source", async () => {
  const service = createExternalConversationService({ store: createMemoryConversationStore(), resolveExecutor: () => { throw Error("offline"); } });
  await service.ensureConversation({ id: "main", ownerId: "owner", title: "Main", execution: { kind: "external", id: "manager" } });
  const events: ConversationFeedEvent[] = Array.from({ length: 10 }, (_, i) => ({version:1,seq:i+1,chatId:"main",type:"message",message:{id:`m${i}`,role:"user",text:"x".repeat(90_000),createdAt:"",revision:1,status:"complete",aliases:[]}}));
  const reads = vi.spyOn(service, "events").mockImplementation(async (_owner, _chat, after) => ({version:1,reset:false,cursor:10,events:events.filter(event=>event.seq>after).slice(0,5)}));
  const handler = createExternalChatHandler({ service, resolveUser: () => ({ id: "owner" }), pollMs:60_000 });
  const response = await handler.fetch(new Request("https://chat.example.com/api/conversations/main/events?after=0",{headers:{accept:"text/event-stream"}}));
  await new Promise(resolve=>setTimeout(resolve,30));
  // No consumer has read yet: the queue may contain one oversized event beyond
  // its byte budget, but must not repeatedly fetch the rest of the backlog.
  expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
  const reader=response.body!.getReader();
  let deadline:ReturnType<typeof setTimeout>|undefined;
  try {
    const ids=await Promise.race([
      (async()=>{let text="";while((text.match(/^id: /gm)??[]).length<10){const next=await reader.read();if(next.done)throw Error("EOF");text+=new TextDecoder().decode(next.value);}return [...text.matchAll(/^id: (\d+)$/gm)].map(match=>Number(match[1]));})(),
      new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("Pull waited for pollMs")),1000);}),
    ]);
    expect(ids).toEqual(Array.from({length:10},(_,i)=>i+1));
    expect(reads.mock.calls.length).toBeGreaterThan(2);
  } finally {clearTimeout(deadline);await reader.cancel();await service.close();}
});
