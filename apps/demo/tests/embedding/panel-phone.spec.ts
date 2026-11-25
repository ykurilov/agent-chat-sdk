import { expect, test } from '@playwright/test';
import { russianLabels } from '@ykurilov/agent-chat-react';
import type { ModelMenu } from '@ykurilov/agent-chat-core';
const modelMenu: ModelMenu = {providers:[{id:'provider',displayName:'Provider',models:[{id:'model',displayName:'Model',acceptsImages:false,reasoning:{levels:['off'],defaultLevel:'off'}}]}],defaultChoice:{providerId:'provider',modelId:'model',reasoning:'off'}};

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function routeChat(page: import('@playwright/test').Page) {
  await page.route('**/api/chat**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path === '/api/chat') return route.fulfill({json:{chats:[{id:'c1',title:'Урок 3',createdAt:'2026-10-01',updatedAt:'2026-10-01'}]}});
    if(path.endsWith('/models')) return route.fulfill({json:modelMenu});
    if(path.endsWith('/branches')) return route.fulfill({json:{forks:[]}});
    if(path.endsWith('/compactions')) return route.fulfill({json:{compactions:[]}});
    if(path.endsWith('/c1')) return route.fulfill({json:{chat:{id:'c1',title:'Урок 3'},messages:[],running:false,compacting:false,compactions:[],forks:[]}});
    return route.fulfill({json:{}});
  });
}

test('phone 360 px: a long own close caption is cut with an ellipsis, no horizontal scroll', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'layout only; nothing WebKit-specific here');
  await page.setViewportSize({ width: 360, height: 780 });
  await routeChat(page);
  const caption = 'Вернуться к уроку про планирование недели и привычки';
  await page.goto(`/?own&caption=${encodeURIComponent(caption)}`);
  await page.getByText('Load panel styles',{exact:true}).click();
  await expect(page.getByText('Styles ready',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ask about the lesson'}).tap();
  const panel = page.locator('aside.oduvanchik-chat');
  await expect(panel).toBeVisible();
  const close = panel.getByRole('button',{name:caption,exact:true});
  await expect(close).toBeVisible();
  const box = await close.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const overflow = await panel.evaluate(element => ({
    panel: element.scrollWidth - element.clientWidth,
    header: element.querySelector('header')!.scrollWidth - element.querySelector('header')!.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ panel: 0, header: 0, page: 0 });
  // Подпись обрезана многоточием, а не вылезает за кнопку.
  const cut = await close.locator('span').evaluate(span => ({ ellipsis: getComputedStyle(span).textOverflow, clipped: span.scrollWidth > span.clientWidth }));
  expect(cut).toEqual({ ellipsis: 'ellipsis', clipped: true });
});

test('phone: own launcher opens the full-screen panel; visible close caption returns focus to it', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'one phone scenario; nothing WebKit-specific here');
  await page.route('**/api/chat**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path === '/api/chat') return route.fulfill({json:{chats:[{id:'c1',title:'Урок 3',createdAt:'2026-10-01',updatedAt:'2026-10-01'}]}});
    if(path.endsWith('/models')) return route.fulfill({json:modelMenu});
    if(path.endsWith('/branches')) return route.fulfill({json:{forks:[]}});
    if(path.endsWith('/compactions')) return route.fulfill({json:{compactions:[]}});
    if(path.endsWith('/c1')) return route.fulfill({json:{chat:{id:'c1',title:'Урок 3'},messages:[],running:false,compacting:false,compactions:[],forks:[]}});
    return route.fulfill({json:{}});
  });
  await page.goto('/?own');
  await page.getByText('Load panel styles',{exact:true}).click();
  await expect(page.getByText('Styles ready',{exact:true})).toBeVisible();
  // Встроенной плавающей кнопки нет: только своя кнопка приложения.
  await expect(page.getByRole('button',{name:russianLabels.agentPanelOpen})).toHaveCount(0);
  const own = page.getByRole('button',{name:'Ask about the lesson'});
  await own.tap();
  const panel = page.locator('aside.oduvanchik-chat');
  await expect(panel).toBeVisible();
  const rect = await panel.boundingBox();
  expect(rect!.width).toBe(390);
  const close = panel.getByRole('button',{name:'Назад к уроку',exact:true});
  await expect(close).toBeVisible();
  await expect(close).toContainText('Назад к уроку');
  const box = await close.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:`test-results/embedding/phone-close-caption-${testInfo.project.name}.png`});
  await close.tap();
  await expect(panel).toBeHidden();
  await expect(own).toBeFocused();
  await expect(own).toHaveAttribute('aria-expanded','false');
});
