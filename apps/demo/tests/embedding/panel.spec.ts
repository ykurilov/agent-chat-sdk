import { expect, test } from '@playwright/test';
import { russianLabels } from '@ykurilov/agent-chat-react';
import type { ModelMenu } from '@ykurilov/agent-chat-core';
const modelMenu: ModelMenu = {providers:[{id:'provider',displayName:'Provider',models:[{id:'model',displayName:'Model',acceptsImages:false,reasoning:{levels:['off'],defaultLevel:'off'}}]}],defaultChoice:{providerId:'provider',modelId:'model',reasoning:'off'}};

test('standalone CSS preserves host, commands focus the same draft, portals are styled', async ({ page }, testInfo) => {
  await page.route('**/api/chat**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path === '/api/chat') return route.fulfill({json:{chats:[{id:'c1',title:'Current chat',createdAt:'2026-10-01',updatedAt:'2026-10-01'}]}});
    if(path.endsWith('/models')) return route.fulfill({json:modelMenu});
    if(path.endsWith('/branches')) return route.fulfill({json:{forks:[]}});
    if(path.endsWith('/compactions')) return route.fulfill({json:{compactions:[]}});
    if(path.endsWith('/c1')) return route.fulfill({json:{chat:{id:'c1'},messages:[],running:false,compacting:false,compactions:[],forks:[]}});
    return route.fulfill({json:{}});
  });
  page.on('pageerror', error => console.log('FIXTURE_PAGE_ERROR', error.message));
  await page.goto('/');
  const host = () => page.evaluate(() => ['body','#host-title','#host-button'].map(selector=> {
    const style=getComputedStyle(document.querySelector(selector)!);
    return ['fontFamily','fontSize','margin','padding','border','color','backgroundColor','boxSizing'].map(key=>style.getPropertyValue(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())));
  }));
  const before=await host();
  await page.getByText('Load panel styles',{exact:true}).click();
  await expect(page.getByText('Styles ready',{exact:true})).toBeVisible();
  expect(await host()).toEqual(before);
  await page.getByText('Edit with AI',{exact:true}).click();
  const panel=page.locator('aside.oduvanchik-chat');
  const input=panel.locator('textarea');
  await expect(input).toBeFocused();
  const panelButton = panel.getByRole('button',{name:russianLabels.agentPanelChats,exact:true});
  expect(await panelButton.evaluate(el=>getComputedStyle(el).borderTopColor)).not.toBe('rgb(81, 21, 111)');
  expect(await panel.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily)).not.toBe('serif');
  await input.fill('Keep my draft');
  await panel.getByRole('button',{name:russianLabels.agentPanelChats,exact:true}).click();
  await panel.getByRole('button',{name:russianLabels.agentPanelClose,exact:true}).click();
  await page.getByText('Edit with AI',{exact:true}).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Keep my draft');
  await expect(panel.getByRole('button',{name:russianLabels.agentPanelChats,exact:true})).toBeVisible();
  await page.locator('#host-button').click();
  await page.getByText('Edit with AI',{exact:true}).click();
  await expect(input).toBeFocused();
  const rect=await panel.boundingBox();expect(rect!.width).toBe(420);expect(rect!.height).toBe(800);
  await page.getByText('Portal menu',{exact:true}).click();
  const menu=page.getByRole('menuitem',{name:'Portal item'});await expect(menu).toBeVisible();
  expect(await menu.evaluate(el=>getComputedStyle(el).paddingTop)).not.toBe('0px');
  await page.keyboard.press('Escape');
  await page.getByText('Portal dialog',{exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
  await page.screenshot({path:`test-results/embedding/embedded-${testInfo.project.name}-light.png`});
  await page.getByRole('dialog').getByRole('button').last().click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(host).toEqual(before);
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  expect(await host()).toEqual(before);
  await page.screenshot({path:`test-results/embedding/embedded-${testInfo.project.name}-dark.png`});
  await page.emulateMedia({colorScheme:'dark'});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await expect.poll(()=>panel.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

});

test('launcher hover keeps readable text in light, dark and host palettes', async ({ page }, testInfo) => {
  await page.goto('/?launcher');
  await page.getByText('Load panel styles',{exact:true}).click();
  await expect(page.getByText('Styles ready',{exact:true})).toBeVisible();
  const launcher=page.getByRole('button',{name:russianLabels.agentPanelOpen,exact:true});
  for(const [name,bg,text,surface] of [
    ['light','rgb(255, 255, 255)','rgb(20, 20, 20)','rgb(242, 242, 240)'],
    ['dark','rgb(15, 15, 15)','rgb(242, 242, 240)','rgb(32, 32, 32)'],
    ['host','rgb(245, 245, 250)','rgb(9, 12, 19)','rgb(230, 232, 240)'],
  ] as const) {
    await page.mouse.move(0,0);
    await launcher.evaluate((el,vars)=>{for(const [key,value] of Object.entries(vars)) el.style.setProperty(key,value)}, {'--yk-bg':bg,'--yk-text':text,'--yk-surface-2':surface});
    await expect(launcher).toHaveCSS('color',text);
    await launcher.hover();
    await expect(launcher).toHaveCSS('background-color',surface);
    await expect(launcher).toHaveCSS('color',text);
    const contrast=await launcher.evaluate(el=>{
      const style=getComputedStyle(el);
      const luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i]!,0);
      const a=luminance(style.color),b=luminance(style.backgroundColor);
      return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await launcher.screenshot({path:`test-results/embedding/launcher-${testInfo.project.name}-${name}-hover.png`});
  }
});
