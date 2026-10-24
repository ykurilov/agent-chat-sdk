import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { screenshotFolder } from "../e2e/support/screen";

type Skin = "oduvanchik" | "tandem";
type Viewport = { x: number; y: number; zoom: number };
const shots = screenshotFolder("agent-chat-flow-navigation");
const errors = new WeakMap<Page, string[]>();
test.use({ actionTimeout: 10_000 });
test.beforeEach(({ page }) => {
  const messages: string[] = []; errors.set(page, messages);
  page.on("pageerror", error => messages.push(error.message));
  page.on("console", message => { if (message.type() === "error") messages.push(message.text()); });
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function viewport(page: Page): Promise<Viewport> {
  return page.locator(".react-flow__viewport").evaluate(element => {
    const m = new DOMMatrix(getComputedStyle(element).transform);
    return { x: m.e, y: m.f, zoom: m.a };
  });
}
async function settled(page: Page) {
  let previous = "";
  await expect.poll(async () => {
    const current = JSON.stringify(await viewport(page));
    const same = current === previous; previous = current; return same;
  }).toBe(true);
}
async function open(page: Page, skin: Skin, { readonly = false, days = false, dark = false } = {}) {
  const params = new URLSearchParams({ theme: dark ? "dark" : "light", header: "compact", inspector: "collapsible", minimap: "collapsed" });
  params.set("flow", skin === "oduvanchik" ? (days ? "days" : "common") : (days ? "marathon-days" : "any-state-settings"));
  if (readonly) params.set("readonly", "1");
  await page.goto(`/${skin === "oduvanchik" ? "oduvanchik-flows" : "flow-editor"}.html?${params}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
}
async function point(page: Page) {
  const rect = (await page.locator(".react-flow").boundingBox())!;
  return { x: rect.x + rect.width * 0.4, y: rect.y + 65, originX: rect.x, originY: rect.y };
}
async function json(page: Page) {
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const value = JSON.parse(await page.getByRole("dialog").getByRole("textbox").inputValue());
  await page.keyboard.press("Escape"); await settled(page); return value;
}
function anchored(before: Viewport, after: Viewport, p: Awaited<ReturnType<typeof point>>) {
  expect((p.x - p.originX - after.x) / after.zoom, "zoom must not add horizontal wheel pan").toBeCloseTo((p.x - p.originX - before.x) / before.zoom, 2);
  expect((p.y - p.originY - after.y) / after.zoom, "zoom must not add vertical wheel pan").toBeCloseTo((p.y - p.originY - before.y) / before.zoom, 2);
}

for (const skin of ["oduvanchik", "tandem"] as const) {
  test.describe(`${skin} desktop`, () => {
    test.skip(({ isMobile }) => isMobile);
    for (const readonly of [false, true]) {
      test(`ordinary wheel pans without zoom or JSON changes${readonly ? " in readOnly fullscreen" : ""}`, async ({ page }) => {
        await open(page, skin, { readonly, dark: readonly });
        if (readonly) { await page.getByRole("button", { name: "На весь экран", exact: true }).click(); await settled(page); }
        const original = await json(page);
        const p = await point(page); const before = await viewport(page);
        await page.mouse.move(p.x, p.y); await page.mouse.wheel(90, 140); await settled(page);
        const after = await viewport(page);
        expect(after.zoom, "plain wheel must preserve zoom").toBeCloseTo(before.zoom, 6);
        expect(after.x, "plain wheel must pan horizontally").toBeLessThan(before.x);
        expect(after.y, "plain wheel must pan vertically").toBeLessThan(before.y);
        await page.mouse.wheel(100, 0); await settled(page); const horizontal = await viewport(page);
        expect(horizontal.x).toBeLessThan(after.x); expect(horizontal.y).toBeCloseTo(after.y, 5); expect(horizontal.zoom).toBeCloseTo(after.zoom, 6);
        await page.mouse.wheel(0, 100); await settled(page); const vertical = await viewport(page);
        expect(vertical.y).toBeLessThan(horizontal.y); expect(vertical.x).toBeCloseTo(horizontal.x, 5); expect(vertical.zoom).toBeCloseTo(horizontal.zoom, 6);
        expect(await json(page)).toEqual(original);
        mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: `${shots}/${skin}-${readonly ? "dark-readonly-fullscreen" : "light"}-pan.png`, animations: "disabled" });
      });
    }

    test("Ctrl wheel pinches around its anchor, Meta retains upstream activation behavior", async ({ page }, info) => {
      await open(page, skin); const original = await json(page); const p = await point(page);
      const before = await viewport(page);
      await page.mouse.move(p.x, p.y); await page.keyboard.down("Control");
      try { await page.mouse.wheel(240, -40); } finally { await page.keyboard.up("Control"); }
      await settled(page); const after = await viewport(page);
      expect(after.zoom).toBeGreaterThan(before.zoom); anchored(before, after, p);
      await page.keyboard.down("Meta");
      try { await page.mouse.wheel(50, 30); } finally { await page.keyboard.up("Meta"); }
      await settled(page); const meta = await viewport(page);
      const zoomed = Math.abs(meta.zoom - after.zoom) > 1e-6;
      if (zoomed) anchored(after, meta, p);
      else { expect(meta.x).toBeLessThan(after.x); expect(meta.y).toBeLessThan(after.y); }
      await info.attach("upstream-meta-wheel", { body: JSON.stringify({ before: after, after: meta, zoomed, browser: info.project.name }), contentType: "application/json" });
      expect(await json(page)).toEqual(original);
    });

    test("mouse pan, node selection/drag and zoom/fit buttons keep their contracts", async ({ page }) => {
      await open(page, skin); const original = await json(page); const p = await point(page);
      const before = await viewport(page); await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + 80, p.y + 50, { steps: 8 }); await page.mouse.up(); await settled(page);
      const after = await viewport(page); expect(after.x).toBeGreaterThan(before.x); expect(after.y).toBeGreaterThan(before.y); expect(after.zoom).toBeCloseTo(before.zoom, 6);
      expect(await json(page)).toEqual(original);
      await page.getByRole("button", { name: "Крупнее", exact: true }).click(); await settled(page);
      expect((await viewport(page)).zoom).toBeGreaterThan(after.zoom);
      await page.getByRole("button", { name: "Мельче", exact: true }).click(); await settled(page);
      expect((await viewport(page)).zoom).toBeCloseTo(after.zoom, 4);
      await page.getByRole("button", { name: "Весь граф", exact: true }).click(); await settled(page);
      const node = page.locator('.react-flow__node[data-id="intro"]');
      const card = node.getByRole("button", { name: "Знакомство", exact: true }); await card.click(); await settled(page);
      const nodeBefore = await node.evaluate(el => el.style.transform); const rect = (await card.boundingBox())!;
      await page.mouse.move(rect.x + 35, rect.y + 32); await page.mouse.down();
      await page.mouse.move(rect.x + 95, rect.y + 72, { steps: 8 }); await page.mouse.up();
      await expect.poll(() => node.evaluate(el => el.style.transform)).not.toBe(nodeBefore);
      const moved = await json(page); expect(moved.layout.intro).not.toEqual(original.layout.intro);
      const pos = await point(page); await page.mouse.move(pos.x, pos.y); await page.mouse.wheel(50, 60); await settled(page);
      expect(await json(page)).toEqual(moved);
    });

    test("bounded canvas consumes wheel while document, inspector and form scroll independently", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 700 }); await open(page, skin, { days: true });
      // Test-only embedding: a bounded editor inside a genuinely scrollable document.
      await page.addStyleTag({ content: "html,body{height:auto;min-height:1800px}#root{height:700px}" });
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
      const p = await point(page); await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, 120); await settled(page);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.getByRole("button", { name: /^Показать панель/ }).click();
      const panel = page.getByRole("region", { name: "Сценарий", exact: true });
      const handle = await panel.evaluateHandle(root => [root, ...root.querySelectorAll<HTMLElement>("*")].find(el => getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight)!);
      const scroller = handle.asElement()!; expect(scroller).toBeTruthy();
      const rect = (await scroller.boundingBox())!; const boardBefore = await viewport(page);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.wheel(0, 180);
      await expect.poll(() => handle.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      expect(await viewport(page)).toEqual(boardBefore);
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const field = page.getByRole("dialog").getByRole("textbox");
      expect(await field.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await field.hover(); await page.mouse.wheel(0, 140);
      await expect.poll(() => field.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      expect(await viewport(page)).toEqual(boardBefore);
    });
  });

  test(`${skin} emulated phone touch pan and two-finger pinch`, async ({ page, isMobile, browserName }) => {
    test.skip(!isMobile); await open(page, skin); const before = await viewport(page); const p = await point(page);
    const session = browserName === "chromium" ? await page.context().newCDPSession(page) : undefined;
    let active: Array<{ x: number; y: number }> = [];
    async function touches(type: "touchStart" | "touchMove" | "touchEnd", coords: Array<{ x: number; y: number }>) {
      if (session) { await session.send("Input.dispatchTouchEvent", { type, touchPoints: coords.map((v, id) => ({ ...v, id })) }); return; }
      // WebKit has no CDP touch dispatcher: exercise its actual d3 touch handlers with structural synthetic touch events.
      // WebKit disallows constructing Touch/TouchEvent; this is handler emulation, not a native device gesture.
      const changed = type === "touchEnd" ? active : coords;
      await page.locator(".react-flow__pane").evaluate((target, { type, coords, changed }) => {
        const list = (items: Array<{ x: number; y: number }>) => items.map((v, identifier) => ({ identifier, target, clientX: v.x, clientY: v.y, pageX: v.x + scrollX, pageY: v.y + scrollY }));
        const touches = list(coords);
        const event = new Event(type.toLowerCase(), { bubbles: true, cancelable: true });
        Object.defineProperties(event, { view: { value: window }, touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: list(changed) } });
        target.dispatchEvent(event);
      }, { type, coords, changed });
      active = coords;
    }
    await touches("touchStart", [{ x: p.x, y: p.y }]); await touches("touchMove", [{ x: p.x + 45, y: p.y + 35 }]); await touches("touchEnd", []); await settled(page);
    const panned = await viewport(page); expect(panned.x).toBeGreaterThan(before.x); expect(panned.y).toBeGreaterThan(before.y); expect(panned.zoom).toBeCloseTo(before.zoom, 5);
    await touches("touchStart", [{ x: p.x - 25, y: p.y }, { x: p.x + 25, y: p.y }]);
    await touches("touchMove", [{ x: p.x - 50, y: p.y }, { x: p.x + 50, y: p.y }]); await touches("touchEnd", []); await settled(page);
    expect((await viewport(page)).zoom).toBeGreaterThan(panned.zoom);
    mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${skin}-${browserName}-phone-touch.png`, animations: "disabled" });
  });
}

test("OD test-chat reader scroll stays independent of the canvas", async ({ page, isMobile }) => {
  test.skip(isMobile); await open(page, "oduvanchik");
  await page.getByRole("button", { name: "Тестовый чат", exact: true }).click();
  const chat = page.locator("[data-flow-test-chat]"); const question = "Навигация по переписке.\n\n".repeat(40);
  await chat.getByRole("textbox", { name: "Сообщение", exact: true }).fill(question);
  await chat.getByRole("button", { name: "Отправить", exact: true }).click(); await expect(chat).toContainText("Понял:");
  await expect(chat.getByRole("button", { name: "Отправить", exact: true })).toBeVisible();
  const feed = chat.locator(".oduvanchik-thread-scroll"); await expect.poll(() => feed.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  const before = await feed.evaluate(el => el.scrollTop); const board = await viewport(page);
  await feed.hover(); await page.mouse.wheel(0, -200); await expect.poll(() => feed.evaluate(el => el.scrollTop)).toBeLessThan(before);
  expect(await viewport(page)).toEqual(board);
});
