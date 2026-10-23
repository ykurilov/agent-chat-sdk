import { test, expect } from "@playwright/test";
import { waitUntilFeedStill } from "../e2e/support/feed";
import { saveScreenshot, screenshotFolder } from "../e2e/support/screen";
const folder=screenshotFolder("agent-chat-parts");
async function expectProgressColors(page: import("@playwright/test").Page, complete: boolean) {
 const colors=await page.locator(".yk-chat-progress").evaluate((element,complete)=>{
  const tokenColor=(token:string)=>{const probe=document.createElement("span");probe.style.cssText=`color:var(${token});transition:none`;element.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;};
  const label=tokenColor(complete?"--yk-success":"--yk-muted");const fill=tokenColor(complete?"--yk-success":"--yk-accent");
  return{label:getComputedStyle(element.querySelector(".yk-chat-progress__label")!).color,fill:getComputedStyle(element.querySelector(".yk-chat-progress__fill")!).backgroundColor,expectedLabel:label,expectedFill:fill};
 },complete);
 expect(colors.label).toBe(colors.expectedLabel);expect(colors.fill).toBe(colors.expectedFill);
}
test("shared chat parts: three applications, controlled completion, geometry, hover/focus/touch and composer",async({page,browser,context},testInfo)=>{
 test.setTimeout(90_000);
 await context.grantPermissions(["clipboard-read","clipboard-write"]);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
 for(const viewport of[{width:1440,height:1000},{width:390,height:844}])for(const theme of["light","dark"])for(const example of["shop","form","task"]){
 await page.setViewportSize(viewport);await page.goto(`/oduvanchik-chat-parts.html?example=${example}&state=done&theme=${theme}`);await page.emulateMedia({reducedMotion:"reduce"});
 const scroll=page.locator('.oduvanchik-thread-scroll');await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','3');await expect(page.getByRole('textbox',{name:'Сообщение'})).toBeHidden();
 const header=page.locator('.yk-chat-header');
 await expect(header).toHaveCSS('box-shadow','none');
 const headerBox=(await header.boundingBox())!;const strip={x:headerBox.x,y:headerBox.y+headerBox.height-8,width:headerBox.width,height:5};
 const cleanEdge=await page.screenshot({clip:strip});
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(header).toHaveClass(/--scrolled/);await expect(header).not.toHaveCSS('box-shadow','none');
 expect((await page.screenshot({clip:strip})).equals(cleanEdge),'feed pixels must stay outside the header').toBe(true);
 await expectProgressColors(page,true);
 const card=page.locator('.yk-completion');await expect(card).toBeInViewport();await expect(page.locator('.yk-scroll-area')).toHaveCount(1);
 await saveScreenshot(page,folder,`parts-${example}-done-${theme}-${viewport.width<700?'phone':'desktop'}`);
 await card.getByRole('button').click();await expectProgressColors(page,false);const field=page.getByRole('textbox',{name:'Сообщение'});await expect(field).toBeFocused();await expect(field).toHaveCSS('height','26px');
 const send=page.getByRole('button',{name:'Отправить',exact:true}),mic=page.getByRole('button',{name:'Диктовать'});await expect(send).toHaveCSS('width','40px');await expect(send).toHaveCSS('border-radius','50%');await expect(mic).toHaveCSS('width','40px');
 const boxes=await page.locator('.yk-chat-header__inner,.oduvanchik-thread,.oduvanchik-composer-column').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
 expect(Math.max(...boxes.map(b=>b.left))-Math.min(...boxes.map(b=>b.left))).toBeLessThanOrEqual(1);expect(Math.max(...boxes.map(b=>b.right))-Math.min(...boxes.map(b=>b.right))).toBeLessThanOrEqual(1);
 const gap=await scroll.evaluate(el=>{const content=el.querySelector('[role="log"]')!.getBoundingClientRect();const rect=el.getBoundingClientRect();return rect.right-content.right-(el as HTMLElement).offsetWidth+el.clientWidth;});expect(gap).toBeGreaterThanOrEqual(16);
 await scroll.evaluate(el=>{el.scrollTop=0;});await expect(page.locator('.yk-chat-header--scrolled')).toHaveCount(0);await expect(page.locator('.yk-chat-header')).toHaveCSS('box-shadow','none');
 await page.mouse.move(0,0);const copy=page.getByRole('button',{name:'Скопировать ответ'}).first();await expect(copy).toHaveCSS('opacity','0');await copy.focus();await expect(copy).toHaveCSS('opacity','1');await copy.click();await expect(page.getByRole('button',{name:'Скопировано'})).toBeVisible();
 await mic.click();await expect(page.getByRole('button',{name:'Остановить диктовку'})).toBeVisible();await page.getByRole('button',{name:'Остановить диктовку'}).click();await field.fill('One');await field.press('Shift+Enter');await expect(field).toHaveValue('One\n');await field.fill(Array(20).fill('Long line').join('\n'));await expect(field).toHaveCSS('height','160px');await field.fill('Question');await field.press('Enter');await expect(page.getByRole('button',{name:'Остановить',exact:true})).toBeVisible();await page.getByRole('button',{name:'Остановить',exact:true}).click();
 await saveScreenshot(page,folder,`parts-${example}-dialog-${theme}-${viewport.width<700?'phone':'desktop'}`);
 }
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,baseURL:new URL(page.url()).origin});const phone=await touch.newPage();await phone.goto('/oduvanchik-chat-parts.html?example=form&state=dialog');await expect(phone.getByRole('button',{name:'Скопировать ответ'}).first()).toHaveCSS('opacity','1');await saveScreenshot(phone,folder,"parts-form-dialog-touch-phone");await touch.close();
 // The public AgentChat entry with an actual virtualised 250-message feed, not the static skin fixture.
 await page.setViewportSize({width:1440,height:1000});await page.goto('/oduvanchik-chat-parts.html?runtime=1&theme=dark');await expect(page.locator('.yk-chat-header')).toHaveClass(/--scrolled/);await expect(page.locator('.yk-chat-header')).not.toHaveCSS('box-shadow','none');
 const liveScroll=page.locator('.oduvanchik-thread-scroll'),items=page.locator('[data-feed-item]');
 await expect(page.getByRole('log')).toContainText('History 249.');
 await expect.poll(()=>items.count()).toBeLessThan(60);
 await liveScroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 const original=await liveScroll.elementHandle();await page.getByRole('button',{name:'Показать / убрать итог'}).click();
 await expect(page.getByRole('region',{name:'Application result'})).toBeVisible();await expect(page.getByRole('textbox',{name:'Сообщение'})).toBeHidden();
 expect(await liveScroll.evaluate((el,old)=>el===old,original)).toBe(true);
 await liveScroll.evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(page.getByRole('region',{name:'Application result'})).toBeInViewport();await expect(page.getByRole('log')).toContainText('History 249.');
 await liveScroll.evaluate(el=>{el.scrollTop-=3*el.clientHeight;});
 await expect.poll(()=>liveScroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeGreaterThan(96);
 // Establish a real reader position only after virtua has mounted/measured the new window.
 const anchor=await waitUntilFeedStill(page);
 expect(await liveScroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeGreaterThan(96);
 const before=await liveScroll.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight}));const beforeAnchor=await anchor.evaluate(el=>({y:el.getBoundingClientRect().top,text:el.textContent?.slice(0,35)}));
 await page.getByRole('button',{name:'Показать / убрать итог'}).click();
 await expect(page.getByRole('textbox',{name:'Сообщение'})).toHaveValue('Unsaved application draft');
 await waitUntilFeedStill(page);
 const after=await liveScroll.evaluate(el=>({top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight}));const afterAnchor=await anchor.evaluate(el=>({connected:el.isConnected,y:el.getBoundingClientRect().top,text:el.textContent?.slice(0,35)}));
 await testInfo.attach('completion-reader-anchor',{body:JSON.stringify({before,beforeAnchor,after,afterAnchor}),contentType:'application/json'});
 expect(afterAnchor.connected).toBe(true);expect(Math.abs(afterAnchor.y-beforeAnchor.y)).toBeLessThanOrEqual(1);expect(after.height-after.top-after.client).toBeGreaterThan(96);
 expect(await liveScroll.evaluate((el,old)=>el===old,original)).toBe(true);expect(errors).toEqual([]);
});
