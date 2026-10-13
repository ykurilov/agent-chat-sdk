import { expect, test } from "@playwright/test";
import { lastAnswer, send, signIn } from "./support/chat";

/* Пятая фича, веб-инструменты: поиск → чтение → ответ со ссылкой; снимок страницы; подписи и результаты в ленте. */

test("поиск и чтение: короткие подписи, ссылки на источники в строке и в ответе", async ({ page }) => {
  await signIn(page);
  await send(page, "Поищи в интернете, какая сейчас версия Node.js");
  const answer = lastAnswer(page);

  await expect(answer.getByRole("button", { name: "Поиск в интернете: выполняется" })).toBeVisible();
  const search = answer.getByRole("button", { name: "Поиск в интернете: готово" });
  const reading = answer.getByRole("button", { name: "Чтение страницы: готово" });
  await expect(search).toBeVisible();
  await expect(reading).toBeVisible();
  await expect(answer).toHaveAttribute("data-status", "complete");
  await expect(answer.getByRole("button", { name: /выполняется|ошибка/ })).toHaveCount(0);

  // В ответе источник — ссылка.
  await expect(answer.getByRole("link", { name: "Node.js — Releases" })).toHaveAttribute(
    "href",
    "https://nodejs.org/en/about/previous-releases",
  );

  // Раскрытая строка поиска показывает запрос и адреса найденных страниц.
  await search.click();
  await expect(answer.getByText("https://nodejs.org/en/blog/release/v26.0.0")).toBeVisible();
  await reading.click();
  await expect(answer.getByText("Источник: https://nodejs.org/en/about/previous-releases")).toBeVisible();

  // После обновления страницы строки на месте.
  await page.reload();
  const restored = lastAnswer(page);
  await expect(restored.getByRole("button", { name: "Поиск в интернете: готово" })).toBeVisible();
  await expect(restored.getByRole("link", { name: "Node.js — Releases" })).toBeVisible();
});

test("скриншот страницы: строка вызова, ответ, и следующий вопрос в том же чате проходит", async ({ page }) => {
  await signIn(page);
  await send(page, "Сделай скриншот страницы про выпуски Node.js");
  const answer = lastAnswer(page);

  const shot = answer.getByRole("button", { name: "Скриншот страницы: готово" });
  await expect(shot).toBeVisible();
  await expect(answer).toContainText("Снимок страницы получен.");
  // Следующий вопрос уходит только после конца ответа: пока он идёт, отправка не срабатывает.
  await expect(answer).toHaveAttribute("data-status", "complete");
  await shot.click();
  // Раскрытая строка рисует снимок картинкой и даёт ссылку на страницу.
  await expect(answer.getByRole("img", { name: "Снимок страницы" })).toBeVisible();

  // Запись в истории — адреса; картинка при сборке следующего запроса скачивается заново и не ломает ход.
  await send(page, "Спасибо, расскажи коротко");
  await expect(lastAnswer(page)).toContainText("Спрашивайте ещё.");
  await expect(lastAnswer(page)).toHaveAttribute("data-status", "complete");
});
