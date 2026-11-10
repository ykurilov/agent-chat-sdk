import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';

/** Бросает на поле событие перетаскивания: с файлом (`Files`) или с текстом. */
async function drag(target: Locator, type: 'dragover' | 'dragleave' | 'drop', payload: 'file' | 'text', relatedTo?: Locator) {
  const related = relatedTo ? await relatedTo.elementHandle() : null;
  await target.evaluate((element, [kind, what, other]) => {
    const transfer = new DataTransfer();
    if (what === 'file') transfer.items.add(new File(['png'], 'photo.png', { type: 'image/png' }));
    else transfer.setData('text/plain', 'просто слова');
    const event = new DragEvent(kind as string, { bubbles: true, cancelable: true, dataTransfer: transfer, relatedTarget: other as Element | null });
    element.dispatchEvent(event);
  }, [type, payload, related] as const);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?drop');
  await page.getByText('Load panel styles', { exact: true }).click();
  await expect(page.getByText('Styles ready', { exact: true })).toBeVisible();
});

test('файл над полем подсвечивает его и показывает подпись, уход и бросок снимают', async ({ page }) => {
  const field = page.locator('.oduvanchik-field');
  const textarea = field.locator('textarea');
  const hint = field.getByText('Отпустите, чтобы прикрепить', { exact: true });
  await expect(hint).toHaveCount(0);
  await drag(textarea, 'dragover', 'file');
  await expect(field).toHaveAttribute('data-dropping', 'true');
  await expect(hint).toBeVisible();
  await expect(field).toHaveCSS('border-top-style', 'dashed');
  // Переход с поля на его дочерний элемент — не выход: подсветка остаётся.
  await drag(textarea, 'dragleave', 'file', field.locator('.oduvanchik-field-bar'));
  await expect(hint).toBeVisible();
  // Настоящий выход из поля.
  await drag(textarea, 'dragleave', 'file', page.locator('output[data-added]'));
  await expect(hint).toHaveCount(0);
  await expect(field).not.toHaveAttribute('data-dropping', 'true');
  await drag(textarea, 'dragover', 'file');
  await expect(hint).toBeVisible();
  await drag(textarea, 'drop', 'file');
  await expect(hint).toHaveCount(0);
  await expect(page.locator('output[data-added]')).toHaveText('photo.png');
});

test('текст без файла поле не подсвечивает', async ({ page }) => {
  const field = page.locator('.oduvanchik-field');
  await drag(field.locator('textarea'), 'dragover', 'text');
  await expect(field).not.toHaveAttribute('data-dropping', 'true');
  await expect(field.getByText('Отпустите, чтобы прикрепить', { exact: true })).toHaveCount(0);
});
