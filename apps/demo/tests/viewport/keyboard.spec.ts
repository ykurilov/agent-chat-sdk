import {expect,test} from '@playwright/test';
import type {Page} from '@playwright/test';
async function viewport(page:Page,height:number,top=0,scale=1) {
 await page.evaluate(({height,top,scale})=>{
  const value=(window as unknown as {testViewport:{height:number;offsetTop:number;scale:number;dispatchEvent:(event:Event)=>void}}).testViewport;
  Object.assign(value,{height,offsetTop:top,scale});value.dispatchEvent(new Event('resize'));
 },{height,top,scale});
}
for(const skin of ['oduvanchik','tandem']) test(`${skin}: visual-only keyboard, pan, close and reader anchoring`,async({page},info)=>{
 await page.addInitScript(()=>{
  const value=Object.assign(new EventTarget(),{height:874,width:402,offsetTop:0,offsetLeft:0,scale:1});
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>value});
  (window as unknown as {testViewport:typeof value}).testViewport=value;
 });
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`/?skin=${skin}${process.env.VIEWPORT_LEGACY ? '&legacy' : ''}`);
 const field=page.locator('textarea').first();await expect(field).toBeVisible();
 const shell=page.locator('[data-agent-chat-app-viewport]');
 expect(await field.evaluate(n=>parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
 await expect(shell).toHaveCSS('height','874px');
 const log=page.getByRole('log');
 await expect(log).toContainText('Message 79');
 const scroller=()=>page.evaluate(()=>{const log=document.querySelector('[role=log]')!;let n=log.parentElement;while(n && !['auto','scroll'].includes(getComputedStyle(n).overflowY))n=n.parentElement;return n?{top:n.scrollTop,height:n.clientHeight,extent:n.scrollHeight}:null;});
 await expect.poll(async()=>{const s=await scroller();return s?s.extent-s.height-s.top:999;}).toBeLessThan(5);
 await expect.poll(async()=>page.evaluate(async()=>{
  const log=document.querySelector('[role=log]')!;let n=log.parentElement!;
  while(!['auto','scroll'].includes(getComputedStyle(n).overflowY))n=n.parentElement!;
  let previous='',steady=0;
  for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);const value=`${n.scrollTop}:${n.scrollHeight}:${n.clientHeight}`;steady=value===previous?steady+1:0;previous=value;if(steady>=12)return true;}return false;
 })).toBe(true);
 const before=await scroller();await field.tap();await expect(field).toBeFocused();await field.fill('Draft survives keyboard');
 await viewport(page,480,120);
 await expect(shell).toHaveCSS('height','480px');await expect(shell).toHaveCSS('top','120px');
 // Visible bottom is layout-coordinate offsetTop + visible height, not dvh.
 await expect.poll(async()=>Math.abs((await field.boundingBox())!.y+(await field.boundingBox())!.height-600)).toBeLessThan(130);
 await expect.poll(async()=>{const box=await page.locator('[data-agent-chat-composer]').boundingBox();return box ? Math.abs(box.y+box.height-600):999;}).toBeLessThan(2);
 expect((await scroller())!.height).toBeLessThan(before!.height);
 await expect.poll(async()=>{const s=await scroller();return s?s.extent-s.height-s.top:999;}).toBeLessThan(5);
 await expect(field).toHaveValue('Draft survives keyboard');
 expect(await page.evaluate(()=>window.scrollY)).toBe(0);
 await page.screenshot({path:info.outputPath(`${skin}-keyboard.png`)});
 // Manual history reading must survive further viewport resizing.
 await log.evaluate(log=>{let n=log.parentElement;while(n && !['auto','scroll'].includes(getComputedStyle(n).overflowY))n=n.parentElement;n!.scrollTop-=250;});
 await expect.poll(async()=>{const s=await scroller();return s?s.extent-s.height-s.top:0;}).toBeGreaterThan(100);
 const reading=await scroller();await viewport(page,420,80);
 await expect.poll(async()=>{const s=await scroller();return s?s.extent-s.height-s.top:0;}).toBeGreaterThan(100);
 expect(Math.abs((await scroller())!.top-reading!.top)).toBeLessThan(5);
 await field.blur();await viewport(page,874,80); // stale iOS offset must not leave a gap on close
 await expect(shell).toHaveCSS('height','874px');await expect(shell).toHaveCSS('top','0px');
 await expect(field).toHaveValue('Draft survives keyboard');
 await page.screenshot({path:info.outputPath(`${skin}-closed.png`)});
 await field.focus();await viewport(page,480);await viewport(page,874);
 await page.getByRole('button',{name:'Route',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mount app'})).toBeVisible();
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
 expect(await page.evaluate(()=>document.documentElement.style.overflow)).toBe('');
 // Virtua reports this browser-generated warning during initial row measurement
 // on the unchanged legacy shell as well; unexpected runtime errors remain failures.
 expect(errors.filter(message=>message!=='ResizeObserver loop completed with undelivered notifications.')).toEqual([]);
});

for(const skin of ['oduvanchik','tandem']) test(`${skin}: resize-content, modal input, pinch and remount`,async({page})=>{
 await page.addInitScript(()=>{
  const value=Object.assign(new EventTarget(),{height:874,width:402,offsetTop:0,offsetLeft:0,scale:1});
  Object.defineProperty(window,'visualViewport',{configurable:true,get:()=>value});
  (window as unknown as {testViewport:typeof value}).testViewport=value;
 });
 await page.goto(`/?skin=${skin}${process.env.VIEWPORT_LEGACY ? '&legacy' : ''}`);
 const shell=page.locator('[data-agent-chat-app-viewport]');
 const field=page.locator('textarea').first();await expect(field).toBeVisible();
 await field.fill('Resize-content draft');
 // Android-style layout and visual viewports contract together.
 await page.setViewportSize({width:402,height:480});await viewport(page,480);
 await expect(shell).toHaveCSS('height','480px');
 await expect.poll(async()=>{const b=await page.locator('[data-agent-chat-composer]').boundingBox();return Math.abs(b!.y+b!.height-480);}).toBeLessThan(2);
 // Preserve user zoom rather than treating scale as another keyboard size.
 await viewport(page,240,30,2);await expect(shell).toHaveCSS('height','480px');
 await viewport(page,480,0,1);await field.blur();await page.setViewportSize({width:402,height:874});await viewport(page,874);
 await expect(shell).toHaveCSS('height','874px');
 await page.getByRole('button',{name:'Dialog',exact:true}).click();
 await page.getByRole('textbox',{name:'Dialog input'}).fill('Modal text');await viewport(page,480);
 await expect(shell).toHaveCSS('height','480px');
 await page.keyboard.press('Escape');await viewport(page,874);
 await expect(page.getByRole('dialog')).not.toBeVisible();
 await expect(field).toHaveValue('Resize-content draft');
 await page.getByRole('button',{name:'Route',exact:true}).click();
 expect(await page.evaluate(()=>document.body.style.position)).toBe('');
 expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 await page.getByRole('button',{name:'Mount app'}).click();
 await expect(shell).toHaveCSS('height','874px');
 await field.focus();await viewport(page,480);await expect(shell).toHaveCSS('height','480px');
});
