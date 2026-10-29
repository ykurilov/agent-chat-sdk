import {describe,it,expect} from 'vitest';
import {createAttachments} from '../src/create-attachments';
import {createExternalAttachments} from '../src/external-attachments';
import {createMemoryAttachmentStorage} from '../src/memory-attachment-storage';

const DAY=86_400_000;
for(const external of [false,true]) describe(external?'external retention':'builtin retention',()=>{
 for(const retention of [7*DAY,null]) it(`keeps queued files after 48h with policy ${retention}`,async()=>{
  let clock=Date.parse('2026-10-01T10:00:00Z');
  const storage=createMemoryAttachmentStorage();
  const common={storage,unsentRetentionMs:retention,now:()=>new Date(clock)};
  const files=external?createExternalAttachments(common):createAttachments(common);
  const upload=async(name:string)=>{
   const result=await files.ingestFile({userId:'owner',chatId:'chat',name,bytes:new TextEncoder().encode('queued photo description')});
   if(!result.ok)throw Error(result.reason);return result.attachment;
  };
  const first=await upload('first.txt');clock+=2*DAY;
  await upload('next.txt');
  expect(await storage.get(first.id)).toBeDefined();
  const accept=async(ownerId='owner')=>external
   ? (files as ReturnType<typeof createExternalAttachments>).accept({ownerId,chatId:'chat',ids:[first.id]})
   : (files as ReturnType<typeof createAttachments>).acceptUserParts({userId:ownerId,chatId:'chat',parts:[{type:'file',url:`attachment:${first.id}`} ]});
  await expect(accept()).resolves.toHaveLength(1);
  await expect(accept('stranger')).rejects.toThrow();
  clock+=8*DAY;
  if(retention===null) await expect(accept()).resolves.toHaveLength(1);
  else await expect(accept()).rejects.toThrow();
 });
 for(const invalid of [0,-1,NaN,Infinity]) it(`rejects invalid policy ${invalid}`,()=>{
  const options={storage:createMemoryAttachmentStorage(),unsentRetentionMs:invalid};
  expect(()=>external?createExternalAttachments(options):createAttachments(options)).toThrow(/unsentRetentionMs/);
 });
});
