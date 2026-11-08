import { test, expect } from "@playwright/test";
for (const mode of ["open", "pending", "answer", "pending-answer"]) test(`reload native fetch: ${mode}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (let i = 0; i < 3; i++) {
    const opened = mode === "pending" ? undefined : page.waitForResponse(response => response.url().includes("/watch"));
    const watch = page.waitForRequest(request => request.url().includes("/watch"));
    await page.goto(`/page-lifecycle.html${mode === "pending" ? "?pending=1" : mode === "pending-answer" ? "?pendingAnswer=1" : ""}`);
    await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
    await watch;
    if (opened) await opened;
    if (mode === "answer" || mode === "pending-answer") {
      const posted = page.waitForRequest(request => request.url().includes("/messages"));
      await page.getByRole("textbox", { name: "Сообщение" }).fill(mode === "pending-answer" ? "Вопрос ".repeat(12000) : "Вопрос");
      await page.getByRole("textbox", { name: "Сообщение" }).press("Enter");
      await posted;
      if (mode === "answer") await expect(page.getByText("Ответ идёт", { exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("back navigation reopens one watch and retains draft when restored from page cache", async ({ page }, info) => {
  const errors: string[] = [];
  const watches: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/watch")) watches.push(request.url()); });
  await page.addInitScript(() => {
    window.addEventListener("pageshow", event => { (window as unknown as { cachedReturn: boolean }).cachedReturn = event.persisted; });
  });
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html");
  await opened;
  await page.getByRole("textbox", { name: "Сообщение" }).fill("Черновик");
  await page.goto("/page-lifecycle-away.html");
  const returned = page.waitForRequest(request => request.url().includes("/watch"));
  await page.goBack();
  await returned;
  await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
  const persisted = await page.evaluate(() => (window as unknown as { cachedReturn: boolean }).cachedReturn);
  info.annotations.push({ type: "pageshow.persisted", description: String(persisted) });
  await info.attach("page-cache", { body: JSON.stringify({ persisted }), contentType: "application/json" });
  if (persisted) await expect(page.getByRole("textbox", { name: "Сообщение" })).toHaveValue("Черновик");
  expect(watches).toHaveLength(2);
  expect(errors).toEqual([]);
});


test("a cancelled beforeunload leaves the same chat usable", async ({ page }) => {
  const errors: string[] = [];
  const watches = new Set<unknown>();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/watch")) watches.add(request); });
  page.on("requestfailed", request => watches.delete(request));
  page.on("requestfinished", request => watches.delete(request));
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html"); await opened;
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.click(); await field.fill("Не уходить");
  await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
  const dialog = new Promise<void>(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
  await page.reload({ timeout: 10000 }).catch(() => {});
  await dialog;
  await expect(field).toHaveValue("Не уходить");
  await expect.poll(() => watches.size).toBe(1);
  await field.press("Enter");
  await expect(page.getByText("Ответ идёт", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("slow document navigation does not reopen requests in a departing document", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html"); await opened;
  await page.goto("/page-lifecycle-delay.html");
  expect(errors).toEqual([]);
});


test("accepted leave prompt with slow navigation does not restart the old chat", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html"); await opened;
  await page.getByRole("textbox", { name: "Сообщение" }).click();
  await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
  page.once("dialog", dialog => dialog.accept());
  await page.goto("/page-lifecycle-delay.html");
  expect(errors).toEqual([]);
});

for (const target of ["long", "streamed"]) test(`accepted navigation: ${target}`, async ({ page }, info) => {
  const errors: string[] = [];
  const events: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.text().startsWith("NAVTRACE")) events.push(message.text()); });
  page.on("request", request => { if (request.isNavigationRequest()) events.push(`request ${Date.now()} ${request.url()}`); });
  page.on("response", response => { if (response.request().isNavigationRequest()) events.push(`headers ${Date.now()} ${response.url()}`); });
  await page.addInitScript(() => {
    for (const type of ["beforeunload", "pagehide", "pageshow"]) window.addEventListener(type, () => console.log("NAVTRACE", type, Date.now()));
  });
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html"); await opened;
  await page.getByRole("textbox", { name: "Сообщение" }).click();
  await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
  page.once("dialog", dialog => dialog.accept());
  await page.goto(`/page-lifecycle-${target}.html`);
  await info.attach("navigation-order", { body: events.join("\n"), contentType: "text/plain" });
  expect(errors).toEqual([]);
});

test("204 navigation leaves the original chat working", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html"); await opened;
  await page.goto("/page-lifecycle-no-content", { timeout: 5000 }).catch(() => {});
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await expect(field).toBeVisible();
  await field.fill("После 204"); await field.press("Enter");
  await expect(page.getByText("Ответ идёт", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const cancel of [false, true]) test(`server generation survives client departure, cancelled=${cancel}`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const chat = await (await page.request.post("/page-generation")).json() as { id: string };
  const opened = page.waitForResponse(response => response.url().includes(`/page-generation/${chat.id}/watch`));
  await page.goto(`/page-lifecycle.html?generation=${chat.id}`); await opened;
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.click(); await field.fill("Вопрос"); await field.press("Enter");
  await expect(page.getByText("Начало", { exact: true })).toBeVisible();
  const before = await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json();
  expect(before.history.running).toBe(true);
  if (cancel) {
    await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
    const resumed = info.project.name === "webkit" ? page.waitForRequest(request => request.url().includes(`/page-generation/${chat.id}/stream`)) : undefined;
    const dialog = new Promise<void>(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
    await page.reload({ timeout: 10000 }).catch(() => {}); await dialog;
    if (resumed) await resumed;
  } else await page.goto("/page-lifecycle-away.html");
  const detached = await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json();
  expect(detached.history.running).toBe(true);
  expect(detached.jobs.at(-1).aborted).toBe(false);
  expect(detached.stopCalls).toBe(0);
  await page.request.post("/page-generation-fixture/finish");
  await expect.poll(async () => (await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json()).history.running).toBe(false);
  if (!cancel) await page.goto(`/page-lifecycle.html?generation=${chat.id}`);
  await expect(page.getByRole("log").getByText("Начало и конец.", { exact: true })).toHaveCount(1);
  const after = await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json();
  expect(after.jobs).toHaveLength(before.jobs.length);
  expect(after.jobs.at(-1)).toEqual({ finished: true, aborted: false });
  expect(after.stopCalls).toBe(0);
  const answers = after.history.messages.filter((message: { role: string }) => message.role === "assistant");
  expect(answers).toHaveLength(1);
  expect(answers[0].parts.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("")).toBe("Начало и конец.");
  expect(errors).toEqual([]);
});

test("cancelled leave before message acceptance keeps the question and retries its original id", async ({ page }) => {
  const errors: string[] = [];
  const sent: Array<{ message: { id: string } }> = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/messages")) sent.push(request.postDataJSON()); });
  const opened = page.waitForResponse(response => response.url().includes("/watch"));
  await page.goto("/page-lifecycle.html?pendingAnswer=1"); await opened;
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.click(); await field.fill("Не терять вопрос");
  await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
  await field.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const dialog = new Promise<void>(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
  await page.reload({ timeout: 10000 }).catch(() => {}); await dialog;
  await expect(page.getByRole("log").getByText("Не терять вопрос", { exact: true })).toHaveCount(1);
  if (test.info().project.name === "webkit") {
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]!.message.id).toBe(sent[0]!.message.id);
  }
  await expect(page.getByText("Ответ идёт", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});


test("accepted question with an unreceived acknowledgement catches up once after cancelled departure", async ({ page }) => {
  const errors: string[] = [];
  let acceptedResponse = false;
  let submitted: unknown;
  page.on("pageerror", error => errors.push(error.message));
  const chat = await (await page.request.post("/page-generation")).json() as { id: string };
  await page.request.post(`/page-generation-fixture/hold-ack?chat=${chat.id}`);
  page.on("request", request => { if (request.url().endsWith(`/${chat.id}/messages`)) submitted = request.postDataJSON(); });
  page.on("response", response => { if (response.url().endsWith(`/${chat.id}/messages`)) acceptedResponse = true; });
  const opened = page.waitForResponse(response => response.url().includes(`/${chat.id}/watch`));
  await page.goto(`/page-lifecycle.html?generation=${chat.id}`); await opened;
  const field = page.getByRole("textbox", { name: "Сообщение" });
  await field.click(); await field.fill("Сервер получил вопрос");
  await page.evaluate(() => window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = "unsaved"; }));
  await field.press("Enter");
  await expect.poll(async () => (await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json()).history.running).toBe(true);
  expect(acceptedResponse).toBe(false);
  const before = await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json();
  const dialog = new Promise<void>(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
  await page.reload({ timeout: 10000 }).catch(() => {}); await dialog;
  await page.request.post("/page-generation-fixture/finish");
  await expect(page.getByRole("log").getByText("Начало и конец.", { exact: true })).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByRole("button", { name: "Повторить", exact: true })).toHaveCount(0);
  // Even an explicit retry of the original request cannot create another question/answer.
  const retry = await page.request.post(`/page-generation/${chat.id}/messages`, { data: submitted });
  expect(retry.status()).toBe(409);
  expect(await retry.json()).toEqual({ error: { kind: "invalid" } });
  const after = await (await page.request.get(`/page-generation-fixture/stats?chat=${chat.id}`)).json();
  expect(after.history.messages.filter((message: { role: string }) => message.role === "user")).toHaveLength(1);
  expect(after.history.messages.filter((message: { role: string }) => message.role === "assistant")).toHaveLength(1);
  expect(after.jobs).toHaveLength(before.jobs.length);
  expect(after.jobs.at(-1)).toEqual({ finished: true, aborted: false });
  expect(after.stopCalls).toBe(0);
  expect(errors).toEqual([]);
});
