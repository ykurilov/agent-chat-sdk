import{test,expect,webkit}from"@playwright/test";
import{saveScreenshot,screenshotFolder}from"../e2e/support/screen";
test.use({actionTimeout:10_000});
const pageErrors = new WeakMap<import("@playwright/test").Page, string[]>();
test.beforeEach(({ page }) => {
 const errors: string[] = []; pageErrors.set(page, errors);
 page.on("pageerror", error => errors.push(error.message));
 page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
});
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
const screenshots=screenshotFolder("agent-chat-oduvanchik-flows");
const route=(theme="light",extra="")=>`/oduvanchik-flows.html?flow=common&header=compact&inspector=collapsible&minimap=collapsed&theme=${theme}${extra}`;
async function openSettings(page:import("@playwright/test").Page){
 const direct=page.getByRole("button",{name:"Общие переходы",exact:true});
 if(await direct.isVisible())await direct.click();else{await page.getByRole("button",{name:"Ещё действия"}).click();await page.getByRole("menuitem",{name:"Общие переходы"}).click();}
 return page.getByRole("region",{name:"Общие переходы",exact:true});
}
test("global transitions are settings: real graph, roundtrip, locked viewing and phone navigation",async({page})=>{
 test.setTimeout(120_000);await page.addInitScript(()=>localStorage.setItem("oduvanchik-flow-board",JSON.stringify({minimap:false,inspector:false,selection:"@any"})));const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
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
 await page.goto(route("dark","&readonly=1"));await page.locator(".react-flow__node").first().waitFor();const locked=await openSettings(page);await expect(locked.getByRole("combobox",{name:"Куда",exact:true})).toBeDisabled();await expect(locked.getByRole("button",{name:"Словами",exact:true})).toBeDisabled();await saveScreenshot(page,screenshots,"dark-desktop-locked");
 const phoneBrowser=await webkit.launch();const context=await phoneBrowser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,baseURL:new URL(page.url()).origin});await context.addInitScript(()=>localStorage.removeItem("oduvanchik-flow-board"));const phone=await context.newPage();phone.on("pageerror",e=>errors.push(e.message));
 for(const theme of["light","dark"]){await phone.goto(route(theme));await phone.locator(".react-flow__node").first().waitFor();const panel=await openSettings(phone);await expect(panel).toBeVisible();await expect(panel.locator("[data-flow-exit-summary]")).toContainText(/finish_dialog/);expect(await phone.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0);await phone.getByRole("button",{name:"Весь граф",exact:true}).click();await expect.poll(async()=>{const r=await phone.locator("[data-flow-board]").boundingBox();const nodes=await phone.locator(".react-flow__node").all();for(const n of nodes){const b=await n.boundingBox();if(!r||!b||b.y<r.y-1||b.y+b.height>r.y+r.height+1)return false;}return true;}).toBe(true);await saveScreenshot(phone,screenshots,`${theme}-phone-settings`);await panel.getByRole("combobox",{name:"Куда",exact:true}).scrollIntoViewIfNeeded();await saveScreenshot(phone,screenshots,`${theme}-phone-controls`);}
 await context.close();await phoneBrowser.close();expect(errors).toEqual([]);
});

test("overview common settings keep their own space before days and side tasks",async({page})=>{
 for(const theme of["light","dark"]){await page.setViewportSize({width:1440,height:1000});await page.goto(route(theme));await page.locator(".react-flow__node").first().waitFor();await page.getByRole("button",{name:/^Показать панель/}).click();
 const common=page.getByRole("region",{name:"Общие переходы",exact:true});const add=(await common.getByRole("button",{name:"Событие",exact:true}).boundingBox())!;const schedule=(await page.locator("[data-flow-schedule]").boundingBox())!;
 expect(add.y+add.height,"global settings controls must not overlap the following settings section").toBeLessThanOrEqual(schedule.y);
 }
});

test("actual FlowTestChat retains chatId on reopen, highlights state, and uses OD chat", async ({ page }) => {
 test.setTimeout(90_000);
 const errors: string[] = []; const starts: string[] = [];
 page.on("pageerror", e => errors.push(e.message));
 page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
 page.on("response", async r => { if (r.url().endsWith("/api/flow-test/start") && r.ok()) starts.push((await r.json()).chatId); });
 await page.goto(route());
 await page.getByRole("button", { name: "Тестовый чат", exact: true }).click();
 const frame = page.locator("[data-flow-test-chat]");
 await expect(frame.locator(".oduvanchik-thread-root")).toBeVisible();
 await expect.poll(() => starts.length).toBe(1);
 await frame.getByRole("textbox", { name: "Сообщение", exact: true }).fill("Проверка скина");
 await frame.getByRole("button", { name: "Отправить", exact: true }).click();
 await expect(frame).toContainText("Понял: Проверка скина");
 await expect(page.locator('.react-flow__node [data-run="current"]')).toHaveCount(1);
 const textBefore = await frame.locator("[data-flow-test-state]").innerText();
 await frame.getByRole("button", { name: "Закрыть", exact: true }).click();
 await expect(frame).toHaveCount(0);
 await page.getByRole("button", { name: "Тестовый чат", exact: true }).click();
 await expect(frame).toContainText("Понял: Проверка скина");
 expect(starts).toHaveLength(1);
 await expect(frame.locator("[data-flow-test-state]")).toHaveText(textBefore);
 await frame.getByRole("button", { name: "+20 мин", exact: true }).click();
 await expect(frame.locator("[data-flow-test-clock]")).toHaveText("+20 мин");
 await saveScreenshot(page, screenshots, "light-desktop-test-chat");
 await page.evaluate(() => document.documentElement.dataset.theme = "dark");
 await saveScreenshot(page, screenshots, "dark-desktop-test-chat");
 await page.getByRole("button", { name: "Общие переходы", exact: true }).click();
 await expect(frame).toHaveCount(0);
 await expect(page.getByRole("region", { name: "Общие переходы", exact: true })).toBeVisible();
 expect(errors).toEqual([]);
});

test("DS fields keep numeric/boolean JSON types through editor save and reload", async ({ page }) => {
 await page.goto(route()); await openSettings(page);
 await page.getByRole("button", { name: "JSON", exact: true }).click();
 const json = page.getByRole("dialog").getByRole("textbox");
 const value = JSON.parse(await json.inputValue());
 value.chatNotes = [{ id: "amount", name: "Сумма", about: "", type: "number", options: [] }, { id: "ready", name: "Готово", about: "", type: "boolean", options: [] }];
 value.anyState.exits[0].when = { type: "data", field: "amount", op: "gt", value: 3 };
 await json.fill(JSON.stringify(value)); await page.getByRole("dialog").getByRole("button", { name: "Загрузить", exact: true }).click();
 await page.keyboard.press("Escape"); const settings = await openSettings(page);
 await settings.getByRole("textbox", { name: "Значение", exact: true }).fill("42");
 await page.getByRole("button", { name: "Сохранить", exact: true }).click();
 await page.reload(); await openSettings(page);
 await page.getByRole("button", { name: "JSON", exact: true }).click();
 const saved = JSON.parse(await page.getByRole("dialog").getByRole("textbox").inputValue());
 expect(saved.anyState.exits[0].when.value).toBe(42);
 await page.keyboard.press("Escape");
 await page.getByRole("region", { name: "Общие переходы", exact: true }).getByRole("combobox", { name: "Поле", exact: true }).selectOption("ready");
 // Changing field normalizes the operation in the headless editor; then choose equality and false.
 await page.getByRole("combobox", { name: "Как сравнить", exact: true }).selectOption("eq");
 await page.getByRole("combobox", { name: "Значение", exact: true }).selectOption("false");
 await page.getByRole("button", { name: "JSON", exact: true }).click();
 const boolean = JSON.parse(await page.getByRole("dialog").getByRole("textbox").inputValue());
 expect(boolean.anyState.exits[0].when.value).toBe(false);
});

test("JSON dialog is above fullscreen, traps focus and restores it without leaving fullscreen", async ({ page }) => {
 await page.goto(route()); await page.locator(".react-flow__node").first().waitFor();
 await page.getByRole("button", { name: "На весь экран", exact: true }).click();
 await page.getByRole("button", { name: "JSON", exact: true }).click();
 const dialog = page.getByRole("dialog", { name: "Граф в формате JSON", exact: true });
 await expect(dialog).toBeVisible();
 const field = dialog.getByRole("textbox"); await field.click(); await expect(field).toBeFocused();
 const hit = await field.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 8, r.y + 8)); });
 expect(hit).toBe(true);
 for (let i = 0; i < 9; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
 await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
 await expect(page.locator("[data-flow-fullscreen]")).toBeVisible();
 await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeFocused();
 await page.keyboard.press("Escape"); await expect(page.locator("[data-flow-fullscreen]")).toHaveCount(0);
});

test("WebKit phone actual test chat in both themes, English flow labels and responsive controls", async ({ page }) => {
 const browser = await webkit.launch(); const errors: string[] = [];
 try { for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: new URL(page.url() === "about:blank" ? "http://127.0.0.1:" + (process.env.SKIN_GALLERY_PORT ?? "5953") : page.url()).origin });
  const phone = await context.newPage(); phone.on("pageerror", e => errors.push(e.message)); phone.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await phone.goto(route(theme, "&lang=en")); await phone.locator(".react-flow__node").first().waitFor();
  await phone.getByRole("button", { name: "More actions" }).click();
  await phone.getByRole("menuitem", { name: "Test chat", exact: true }).click();
  const frame = phone.locator("[data-flow-test-chat]");
  await expect(frame.locator(".oduvanchik-thread-root")).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await frame.getByRole("textbox", { name: "Сообщение", exact: true }).fill("Phone check");
  await frame.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(frame).toContainText("Понял: Phone check");
  await saveScreenshot(phone, screenshots, `${theme}-phone-test-chat`);
  await frame.getByRole("button", { name: "Close", exact: true }).click();
  await saveScreenshot(phone, screenshots, `${theme}-phone-editor-en`);
  await context.close();
 } } finally { await browser.close(); }
 expect(errors).toEqual([]);
});

test("DS days, nudges, side tasks and node duration remain editable and fit phone", async ({ page }) => {
 test.setTimeout(60_000);
 // Screenshots of the long settings panel use the supported reduced-motion mode.
 await page.emulateMedia({ reducedMotion: "reduce" });
 await page.goto("/oduvanchik-flows.html?flow=days&theme=light");
 await page.getByRole("button", { name: /^Показать панель/ }).click();
 const schedule = page.locator("[data-flow-schedule]");
 await expect(schedule.getByRole("switch", { name: "Сценарий по дням" })).toBeChecked();
 await schedule.getByRole("spinbutton", { name: "Сколько дней", exact: true }).fill("5");
 const tasks = page.locator("[data-flow-side-tasks]");
 await tasks.getByRole("button", { name: "Добавить задачу", exact: true }).click();
 await tasks.locator("[data-side-task]").last().getByRole("textbox", { name: "Что сделать", exact: true }).fill("Проверить итог");
 const node = page.locator(".react-flow__node").filter({ hasText: "День 2: практика" });
 await node.getByRole("button").first().click();
 const timing = page.locator("[data-flow-state-timing]");
 await timing.getByRole("spinbutton", { name: "Длится: дней", exact: true }).fill("3");
 await timing.getByRole("radio", { name: "Выкл", exact: true }).click();
 await expect(node.locator("[data-flow-node-timing]")).toHaveText("3 дня · без касаний");
 await saveScreenshot(page, screenshots, "light-desktop-days");
 await page.evaluate(() => document.documentElement.dataset.theme = "dark");
 await saveScreenshot(page, screenshots, "dark-desktop-days");
 await page.getByRole("button", { name: "JSON", exact: true }).click();
 const json = JSON.parse(await page.getByRole("dialog").getByRole("textbox").inputValue());
 expect(json.schedule.lengthDays).toBe(5);
 expect(json.sideTasks.some((task: { text: string }) => task.text === "Проверить итог")).toBe(true);
 await page.keyboard.press("Escape");
 await page.setViewportSize({ width: 390, height: 844 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
 // Resize can leave offscreen DS transitions pending in Chromium. The screenshot
 // API finishes finite animations without waiting for offscreen animation promises.
 await test.info().attach("phone-resize-animations", { contentType: "application/json", body: JSON.stringify(await page.evaluate(() => document.getAnimations().map(a => ({ state: a.playState, timing: a.effect?.getTiming(), target: ((a.effect as KeyframeEffect)?.target as Element)?.tagName })))) });
 await page.screenshot({ path: `${screenshots}/dark-phone-days.png`, animations: "disabled" });
});

test("combined chat and flows CSS imports DS controls once", async ({ page }) => {
 await page.goto(route()); const panel = await openSettings(page); await expect(panel).toBeVisible();
 const count = await page.evaluate(() => {
  const find = (rules: CSSRuleList): number => [...rules].reduce((sum, rule) => sum +
   (rule instanceof CSSStyleRule && rule.selectorText === ".yk-button--primary" ? 1 : 0) +
   ("cssRules" in rule ? find((rule as CSSGroupingRule).cssRules) : 0), 0);
  return [...document.styleSheets].reduce((sum, sheet) => sum + find(sheet.cssRules), 0);
 });
 expect(count).toBe(1);
 const fonts = await panel.locator(".yk-segmented__item").first().evaluate(el => {
  const probe = document.createElement("span"); probe.style.fontFamily = "var(--yk-font-mono)"; el.append(probe);
  const result = { actual: getComputedStyle(el).fontFamily, expected: getComputedStyle(probe).fontFamily }; probe.remove(); return result;
 });
 expect(fonts.actual).toBe(fonts.expected);
});
