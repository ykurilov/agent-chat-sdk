import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) for (const mode of ['push', 'overlay']) {
  test(`${theme} ${mode}: panel density is independent of monitor width and full-screen defaults`, async ({page}, info) => {
    await page.setViewportSize({width:1920,height:900});
    await page.goto(`/?density&mode=${mode}`);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme, theme);
    await page.getByText('Load panel styles',{exact:true}).click();
    await expect(page.getByText('Styles ready',{exact:true})).toBeVisible();
    const panel=page.locator('aside.oduvanchik-chat');
    const full=page.locator('[data-fullscreen-control]');
    await expect(panel.locator('.oduvanchik-thread')).toHaveCSS('font-size','14px');
    await expect(full.locator('.oduvanchik-thread')).toHaveCSS('font-size','16px');
    await expect(panel.locator('header')).toHaveCSS('height','57px');
    const fullInput=await full.locator('textarea').evaluate(el=>getComputedStyle(el).fontSize);
    await page.locator('[data-density-host]').evaluate(el=>{
      el.style.setProperty('--yk-studio-composer-size','14px');
      el.style.setProperty('--yk-studio-panel-header-height','36px');
      el.style.setProperty('--yk-studio-panel-control-size','28px');
    });
    await expect(panel.locator('header')).toHaveCSS('height','36px');
    await expect(panel.locator('textarea')).toHaveCSS('font-size','14px');
    await expect(panel.locator('.oduvanchik-agent-panel-close')).toHaveCSS('width','28px');
    for(const button of await panel.locator('header button').all()) {
      const b=(await button.boundingBox())!,h=(await panel.locator('header').boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(h.y);
      expect(b.y+b.height).toBeLessThanOrEqual(h.y+h.height);
    }
    // Variables are inherited from the host, but compact header styles stay panel-scoped.
    await expect(full.locator('.oduvanchik-thread')).toHaveCSS('font-size','16px');
    await page.screenshot({path:`test-results/embedding/density-${info.project.name}-${theme}-${mode}.png`});
    await page.setViewportSize({width:1440,height:900});
    await expect(panel.locator('.oduvanchik-thread')).toHaveCSS('font-size','14px');
    await expect(full.locator('.oduvanchik-thread')).toHaveCSS('font-size','14px');
    await page.locator('[data-density-host]').evaluate(el=>el.style.removeProperty('--yk-studio-composer-size'));
    await expect(full.locator('textarea')).toHaveCSS('font-size',fullInput);
    await page.setViewportSize({width:390,height:844});
    await expect(panel.locator('textarea')).toHaveCSS('font-size','16px');
    await expect(panel).toHaveCSS('width','390px');
  });
}

test('compact header retains touch targets on coarse pointers', async ({page,browserName}) => {
  test.skip(browserName !== 'chromium', 'Pointer media emulation uses a touch browser context below.');
  const context=await page.context().browser()!.newContext({hasTouch:true,viewport:{width:390,height:844}});
  const touch=await context.newPage();
  await touch.goto('/?density');
  await touch.getByText('Load panel styles',{exact:true}).click();
  await expect(touch.getByText('Styles ready',{exact:true})).toBeVisible();
  const panel=touch.locator('aside.oduvanchik-chat');
  await panel.evaluate(el=>{el.style.setProperty('--yk-studio-panel-header-height','36px');el.style.setProperty('--yk-studio-panel-control-size','28px');el.style.setProperty('--yk-studio-composer-size','14px')});
  await expect(panel.locator('header')).toHaveCSS('height','44px');
  for(const button of await panel.locator('header button').all()) {
    const box=(await button.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(panel.locator('textarea')).toHaveCSS('font-size','16px');
  await context.close();
});
