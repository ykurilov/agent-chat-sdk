import {expect,it} from "vitest";
import {createMemoryAttachmentStorage} from "../src/memory-attachment-storage";
import {createExternalAttachments} from "../src/external-attachments";
it("raw ZIP opt-in shares durable storage and owner isolation; attached files cannot be removed",async()=>{
 const storage=createMemoryAttachmentStorage();const files=createExternalAttachments({storage,allowGenericFiles:true});
 const uploaded=await files.ingestFile({userId:"u",chatId:"c",name:"data.zip",bytes:new Uint8Array([80,75,3,4])});expect(uploaded.ok).toBe(true);if(!uploaded.ok)throw Error(uploaded.reason);
 const ref=uploaded.attachment;expect(ref.kind).toBe("file");
 await expect(files.accept({ownerId:"other",chatId:"c",ids:[ref.id]})).rejects.toThrow();
 const refs=await files.accept({ownerId:"u",chatId:"c",ids:[ref.id]});await files.confirm({ownerId:"u",chatId:"c",attachments:refs});
 const response=await files.handle({request:new Request("https://example.test/a",{method:"DELETE"}),userId:"u",chatId:"c",segments:[ref.id]});expect(response.status).toBe(409);
 const download=await files.handle({request:new Request("https://example.test/a"),userId:"u",chatId:"c",segments:[ref.id]});expect(download.headers.get("content-disposition")).toMatch(/^attachment/);
 expect(Array.from(await(files.open({ownerId:"u",chatId:"c",attachment:refs[0]!})).then(x=>x.readBytes()))).toEqual([80,75,3,4]);
});
it("generic bytes remain refused unless enabled and stay subject to maxFileBytes",async()=>{
 const input={userId:"u",chatId:"c",name:"data.zip",bytes:new Uint8Array([80,75,3,4])};
 expect(await createExternalAttachments({storage:createMemoryAttachmentStorage()}).ingestFile(input)).toEqual({ok:false,reason:"unsupported_type"});
 expect(await createExternalAttachments({storage:createMemoryAttachmentStorage(),allowGenericFiles:true,limits:{maxFileBytes:3}}).ingestFile(input)).toEqual({ok:false,reason:"too_large"});
});
