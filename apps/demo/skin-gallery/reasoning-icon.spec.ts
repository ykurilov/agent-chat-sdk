import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) for (const width of [1100, 360]) {
  test(`reasoning icon ${theme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/oduvanchik-composers.html?theme=${theme}&reasoning=icon`);
    const composer = page.locator('[data-composer-variant="extended"]');
    const chip = composer.locator('.oduvanchik-chip-reasoning');
    await expect(chip).toHaveAccessibleName("Рассуждения: Высоко");
    await expect(chip).toHaveAttribute("title", "Рассуждения: Высоко");
    await expect(chip).toHaveText("");
    await expect(chip.locator('svg')).toHaveCount(2);
    await expect(chip.locator('.oduvanchik-chip-caret')).toBeVisible();
    const bounds = await chip.boundingBox();
    expect(bounds!.width).toBeLessThan(60);
    await chip.click();
    await page.getByRole("button", { name: "Низко", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(chip).toHaveAccessibleName("Рассуждения: Низко");
    await expect(chip).toHaveAttribute("title", "Рассуждения: Низко");
    await expect(chip).toBeFocused();
    await composer.screenshot({ path: `test-results/reasoning-icon/${theme}-${width}.png` });
    expect(await composer.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
