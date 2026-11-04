import { expect, test } from "@playwright/test";

for (const skin of ["oduvanchik", "tandem"]) for (const theme of ["light", "dark"]) {
  test(`${skin} ${theme}: ранняя карточка ждёт конца потока, затем принимает решение`, async ({ page }) => {
    await page.goto(`/approval-race.html?skin=${skin}&theme=${theme}`);
    const input = page.getByRole("textbox", { name: "Сообщение", exact: true });
    await input.fill("Подготовь план");
    await input.press("Enter");
    const allow = page.getByRole("button", { name: "Разрешить", exact: true });
    await expect(allow).toBeVisible();
    await expect(allow).toBeDisabled();
    await expect(page.getByRole("button", { name: "Отклонить", exact: true })).toBeDisabled();
    await expect(page.getByText("Агент завершает ответ…", { exact: true })).toBeVisible();
    await allow.click({ force: true });
    await expect(page.locator("output")).toHaveAttribute("data-decisions", "");
    await page.getByRole("button", { name: "Закончить ход стенда" }).click();
    await expect(allow).toBeEnabled();
    await expect(page.getByText("Агент завершает ответ…", { exact: true })).toHaveCount(0);
    await allow.click();
    await expect(page.locator("output")).toHaveAttribute("data-decisions", "allow");
    await expect(allow).toHaveCount(0);
  });
}
