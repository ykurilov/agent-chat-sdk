import{test,expect,webkit}from"@playwright/test";
import{saveScreenshot,screenshotFolder}from"../e2e/support/screen";
test.use({actionTimeout:10_000});
const screenshots=screenshotFolder("agent-chat-any-state-settings");
const route=(theme="light",extra="")=>`/flow-editor.html?flow=any-state-settings&header=compact&inspector=collapsible&minimap=collapsed&theme=${theme}${extra}`;
async function openSettings(page:import("@playwright/test").Page){
 const direct=page.getByRole("button",{name:"Общие переходы",exact:true});
 if(await direct.isVisible())await direct.click();else{await page.getByRole("button",{name:"Ещё действия"}).click();await page.getByRole("menuitem",{name:"Общие переходы"}).click();}
 return page.getByRole("region",{name:"Общие переходы",exact:true});
}
test("global transitions are settings: real graph, roundtrip, locked viewing and phone navigation",async({page})=>{
 test.setTimeout(120_000);await page.addInitScript(()=>localStorage.setItem("agent-chat-flow-board",JSON.stringify({minimap:false,inspector:false,selection:"@any"})));const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
 for(const theme of["light","dark"]){
 await page.setViewportSize({width:1440,height:1000});await page.goto(route(theme));await expect(page.locator(".react-flow__node")).toHaveCount(3);await expect(page.locator('.react-flow__node[data-id="@any"]')).toHaveCount(0);await expect(page.locator("[data-edge]")).toHaveCount(2);
 const panel=await openSettings(page);await expect(panel).toBeVisible();await expect(panel.locator("[data-flow-exit-summary]")).toContainText(/finish_dialog.*→.*Завершение разговора/);
 await page.getByRole("button",{name:/^Скрыть панель/}).click();await expect(panel).toBeHidden();await openSettings(page);await expect(panel).toBeVisible();
 await page.getByRole("button",{name:"Весь граф",exact:true}).click();let previous="";await expect.poll(async()=>{const current=await page.locator(".react-flow__viewport").evaluate(el=>getComputedStyle(el).transform);const stable=current===previous;previous=current;return stable;}).toBe(true);
 const bounds=(await page.locator("[data-flow-board]").boundingBox())!;for(const node of await page.locator(".react-flow__node").all()){const rect=(await node.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(bounds.x);expect(rect.x+rect.width).toBeLessThanOrEqual(bounds.x+bounds.width);}
 await page.getByRole("button",{name:"Показать мини-карту"}).click();await expect(page.locator(".react-flow__minimap-node")).toHaveCount(3);
 await saveScreenshot(page,screenshots,`${theme}-desktop-settings`);
 await page.getByRole("button",{name:"На весь экран",exact:true}).click();await expect(page.locator("[data-flow-fullscreen]")).toBeVisible();await saveScreenshot(page,screenshots,`${theme}-desktop-fullscreen`);await page.keyboard.press("Escape");
 const card=panel.locator("[data-exit-card]").first();await card.getByRole("combobox",{name:"Куда",exact:true}).selectOption("review");await panel.getByRole("button",{name:"Знакомство",exact:true}).click();
 await expect(panel.locator("[data-flow-exit-summary]")).toContainText(/Обсуждение/);
 await card.getByRole("combobox").nth(0).selectOption("message");await card.getByRole("combobox").nth(0).selectOption("tool");await card.getByRole("combobox").nth(1).selectOption("finish_dialog");
 await panel.getByRole("button",{name:"Словами",exact:true}).click();const addedId=await panel.locator("[data-exit-card]").last().getAttribute("data-exit-card");const added=panel.locator(`[data-exit-card="${addedId}"]`);await added.getByRole("textbox",{name:"Когда"}).fill("Человек попросил продолжить");await added.getByRole("combobox",{name:"Куда",exact:true}).selectOption("intro");
 await added.getByRole("button",{name:"Выше",exact:true}).click();await expect(panel.locator("[data-exit-card]").first()).not.toHaveAttribute("data-exit-card","finish_dialog");await added.getByRole("button",{name:"Ниже",exact:true}).click();await added.getByRole("button",{name:"Удалить условие",exact:true}).click();await expect(panel.locator("[data-exit-card]")).toHaveCount(1);
 await card.getByRole("combobox",{name:"Куда",exact:true}).selectOption("");await page.getByRole("button",{name:/^Скрыть панель/}).click();await page.getByRole("button",{name:/Проверить граф/}).click();await page.getByRole("region",{name:"Проверка",exact:true}).getByRole("button").filter({hasText:/никуда не ведёт/}).click();await expect(page.locator('[data-flow-exit-focus="finish_dialog"]')).toBeFocused();await card.getByRole("combobox",{name:"Куда",exact:true}).selectOption("review");
 await page.getByRole("button",{name:"JSON",exact:true}).click();const json=page.getByRole("dialog").getByRole("textbox");const saved=JSON.parse(await json.inputValue());expect(saved.anyState.exits[0].to).toBe("review");expect(saved.anyState.exits[0].when).toEqual({type:"event",event:"tool",name:"finish_dialog"});expect(saved.anyState.except).toContain("intro");expect(saved.layout['@any']).toEqual({x:-5000,y:-5000});await page.keyboard.press("Escape");
 }
 await page.goto(route("dark","&readonly=1"));await page.locator(".react-flow__node").first().waitFor();const locked=await openSettings(page);await expect(locked.getByRole("combobox",{name:"Куда",exact:true})).toBeDisabled();await saveScreenshot(page,screenshots,"dark-desktop-locked");
 const phoneBrowser=await webkit.launch();const context=await phoneBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,baseURL:new URL(page.url()).origin});await context.addInitScript(()=>localStorage.removeItem("agent-chat-flow-board"));const phone=await context.newPage();phone.on("pageerror",e=>errors.push(e.message));
 for(const theme of["light","dark"]){await phone.goto(route(theme));await phone.locator(".react-flow__node").first().waitFor();const panel=await openSettings(phone);await expect(panel).toBeVisible();await expect(panel.locator("[data-flow-exit-summary]")).toContainText(/finish_dialog/);expect(await phone.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);await saveScreenshot(phone,screenshots,`${theme}-phone-settings`);}
 await context.close();await phoneBrowser.close();expect(errors).toEqual([]);
});

test("overview common settings keep their own space before days and side tasks",async({page})=>{
 for(const theme of["light","dark"]){await page.setViewportSize({width:1440,height:1000});await page.goto(route(theme));await page.locator(".react-flow__node").first().waitFor();await page.getByRole("button",{name:/^Показать панель/}).click();
 const common=page.getByRole("region",{name:"Общие переходы",exact:true});const add=(await common.getByRole("button",{name:"Событие",exact:true}).boundingBox())!;const schedule=(await page.locator("[data-flow-schedule]").boundingBox())!;
 expect(add.y+add.height,"global settings controls must not overlap the following settings section").toBeLessThanOrEqual(schedule.y);
 }
});
