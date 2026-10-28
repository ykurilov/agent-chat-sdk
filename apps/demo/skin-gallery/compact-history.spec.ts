import { expect, test } from "@playwright/test";
import { compactHistory, historyPart } from "../../../packages/server/src/history-view";
import type { ChatHistory } from "@ykurilov/agent-chat-core";
const raw=()=>({chat:{id:"c1"},messages:Array.from({length:90},(_,i)=>({id:`a${i}`,role:"assistant",metadata:{status:"complete",thoughtTitles:{"0":`Thought ${i}`}},parts:[{type:"reasoning",text:`REASONING_${i} `+"word ".repeat(1600),state:"done"},{type:"tool-read_file",toolCallId:`t${i}`,state:"output-available",input:{path:`file-${i}.ts`},output:`OUTPUT_${i} `+"x".repeat(22000)},{type:"text",text:`Visible answer ${i}. `+"A regular visible paragraph. ".repeat(8),state:"done"}]})),forks:[],compactions:[],running:false,detachedAnswer:false,compacting:false} as unknown as ChatHistory);
for(const simple of [false,true])for(const skin of ["oduvanchik","tandem"])for(const theme of ["light","dark"]){
 test(`${skin} ${theme} ${simple?"simple":"detailed"}: lazy details, page hydration and scroll anchor`,async({page},testInfo)=>{
  const history=raw(); let details=0; const sizes:number[]=[];
  let releaseLast!:()=>void;const lastGate=new Promise<void>(resolve=>{releaseLast=resolve;});
  let releaseOlder!:()=>void; const olderGate=new Promise<void>(resolve=>{releaseOlder=resolve;});
  await page.route("**/compact-fixture/**",async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith("/watch")){await route.fulfill({status:204});return;}
   if(url.pathname.endsWith("/history-part")){details++;await route.fulfill({json:historyPart(history,url.searchParams)});return;}
   if(url.pathname.endsWith("/c1")){if(url.searchParams.has("before")) await (url.searchParams.get("before")==="a30"?lastGate:olderGate); const result=compactHistory(history,url.searchParams);sizes.push(Buffer.byteLength(JSON.stringify(result)));await route.fulfill({json:result});return;}
   if(url.pathname.endsWith("/compactions")){await route.fulfill({json:{compactions:[]}});return;}
   await route.fulfill({status:404,json:{error:{kind:"not_found"}}});
  });
  await page.goto(`/compact-history.html?skin=${skin}&theme=${theme}&simple=${simple?1:0}`);
  const info=page.locator("output[data-history-kind]");
  await expect(info).toHaveAttribute("data-history-kind","history");
  await expect(info).toHaveAttribute("data-shown","30"); await expect(info).toHaveAttribute("data-total","90");
  expect(sizes[0]).toBeLessThan(100000); expect(details).toBe(0);
  if(simple) await page.getByRole("button",{name:/Сделан/}).last().click();
  await page.getByRole("button",{name:"Thought 89",exact:false}).click();
  await expect(info).toHaveAttribute("data-history-kind","details");
  await expect(page.getByText("REASONING_89",{exact:false})).toBeVisible(); expect(details).toBe(1);
  // Long expanded reasoning follows the bottom until a real reader scrolls up.
  // Playwright's automatic scrollIntoView is layout-driven, not reader input.
  const thought=page.getByRole("button",{name:"Thought 89",exact:false});
  const position=await thought.boundingBox();
  if(position && position.y<30){
    const box=await page.getByRole("log").evaluate(el=>el.parentElement!.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,-Math.ceil(100-position.y));
  }
  await thought.click();
  const tool=page.locator('[data-tool-state="done"]').last();
  await tool.getByRole("button").first().click();
  await expect(page.getByText("OUTPUT_89",{exact:false})).toBeVisible(); expect(details).toBe(2);
  await tool.getByRole("button").first().click();
  const log=page.getByRole("log");
  const scrollBox=await log.evaluate(el=>el.parentElement!.getBoundingClientRect().toJSON());
  await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
  await page.mouse.wheel(0,-100000);
  const anchor=page.getByText("Visible answer 60.",{exact:false});
  await expect(anchor).toBeVisible();
  const before=await anchor.boundingBox();
  releaseOlder();
  await expect(info).toHaveAttribute("data-shown","60"); await expect(info).toHaveAttribute("data-history-kind","older-page");
  await expect(info).toHaveAttribute("data-total","90");
  await expect.poll(()=>log.evaluate(el=>el.parentElement!.scrollTop)).toBeGreaterThan(100);
  await expect.poll(async()=>Math.abs((await anchor.boundingBox())!.y-before!.y)).toBeLessThanOrEqual(2);
  await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
  await page.mouse.wheel(0,-100000);
  const lastAnchor=page.getByText("Visible answer 30.",{exact:false});await expect(lastAnchor).toBeVisible();
  const lastBefore=await lastAnchor.boundingBox();releaseLast();
  await expect(info).toHaveAttribute("data-shown","90");
  await expect(page.getByRole("button",{name:"Более ранние сообщения",exact:true})).toHaveCount(0);
  await expect.poll(async()=>Math.abs((await lastAnchor.boundingBox())!.y-lastBefore!.y)).toBeLessThanOrEqual(2);
  await page.screenshot({path:testInfo.outputPath(`${skin}-${theme}-history.png`),fullPage:true});
 });
}
