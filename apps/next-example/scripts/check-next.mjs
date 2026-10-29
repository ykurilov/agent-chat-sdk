#!/usr/bin/env node
// Проверка Next.js подключения на живом сервере (`next start` после сборки и `next dev`):
// сообщение уходит, ответ идёт по частям, к идущему ответу можно подключиться, остановка работает,
// чужой пользователь получает 404, история каждый раз свежая. Запуск: `pnpm test:next` из корня.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bundlerFlags = process.argv.includes("--webpack") ? ["--webpack"] : [];
const appFolder = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = createRequire(join(appFolder, "package.json")).resolve("next/dist/bin/next");
const cookie = (user) => ({ cookie: `chat-user=${user}`, "accept-encoding": "gzip" });
const json = { "content-type": "application/json" };

const failures = [];
const check = (condition, description) => {
  if (!condition) failures.push(description);
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`);
};

const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

function run(args, options = {}) {
  return spawn(process.execPath, [nextBin, ...args], { cwd: appFolder, stdio: ["ignore", "pipe", "pipe"], detached: true, ...options });
}

async function build() {
  const child = run(["build", ...bundlerFlags]);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) throw new Error(`next build упал:\n${output}`);
  if (/Critical dependency:/.test(output)) throw new Error(`Next build emitted critical dependency warnings:\n${output}`);
}

async function startServer(mode) {
  const port = await freePort();
  const child = run([mode, ...(mode === "dev" ? bundlerFlags : []), "-p", String(port), "-H", "127.0.0.1"]);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next ${mode} закончился сразу:\n${output}`);
    if (Date.now() > deadline) throw new Error(`next ${mode} не запустился за 60 с:\n${output}`);
    const ready = await fetch(base).then((response) => response.status === 200, () => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { base, stop: () => process.kill(-child.pid, "SIGTERM"), output: () => output };
}

const userMessage = (id, text) => JSON.stringify({ message: { id, role: "user", parts: [{ type: "text", text }] } });

/** Читает SSE-поток до конца, запоминая, когда пришёл каждый кусок с текстом. */
async function readStream(response, onDelta = () => {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  const deltaTimes = [];
  let text = "";
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const piece = decoder.decode(read.value, { stream: true });
    text += piece;
    const count = piece.split('"type":"text-delta"').length - 1;
    for (let index = 0; index < count; index++) {
      deltaTimes.push(Date.now() - started);
      await onDelta(deltaTimes.length);
    }
  }
  return { text, deltaTimes };
}

async function scenario(mode, base) {
  const label = `[${mode}]`;
  const page = await fetch(base);
  check(page.status === 200, `${label} страница / открывается`);
  const html = await page.text();
  check(html.includes('data-attachment-ssr="ready"'), `${label} attachment hooks render on the server`);

  const created = await fetch(`${base}/api/chat`, { method: "POST", headers: cookie("anna") });
  const { id } = await created.json();
  check(created.status === 201 && Boolean(id), `${label} чат создаётся`);

  const pdf = new FormData();
  pdf.append("file", new Blob([samplePdf()], {type:"application/pdf"}), "probe.pdf");
  const uploaded = await fetch(`${base}/api/chat/${id}/attachments`, {method:"POST",headers:cookie("anna"),body:pdf});
  const file = await uploaded.json();
  check(uploaded.status === 201 && file.textTokens > 0, `${label} actual PDF worker extracted text (${uploaded.status}: ${JSON.stringify(file)})`);

  const anonymous = await fetch(`${base}/api/chat/${id}`);
  check(anonymous.status === 401, `${label} без пользователя — 401`);

  // 1. Ответ идёт по частям.
  const sent = await fetch(`${base}/api/chat/${id}/messages`, { method: "POST", headers: { ...cookie("anna"), ...json }, body: userMessage("u1", "Привет") });
  check(sent.status === 200 && (sent.headers.get("content-type") ?? "").includes("text/event-stream"), `${label} сообщение уходит, ответ — поток`);
  const { text, deltaTimes } = await readStream(sent);
  const spread = deltaTimes.length > 1 ? deltaTimes.at(-1) - deltaTimes[0] : 0;
  check(deltaTimes.length >= 3, `${label} куски приходят отдельно (${deltaTimes.length} шт.)`);
  check(spread >= 1000, `${label} куски растянуты во времени, поток не буферизуется (${spread} мс между первым и последним)`);
  check(text.includes('"type":"finish"'), `${label} поток закончился ответом целиком`);

  // 2. Переподключение к идущему ответу.
  const second = await fetch(`${base}/api/chat/${id}/messages`, { method: "POST", headers: { ...cookie("anna"), ...json }, body: userMessage("u2", "Ещё") });
  let resumed = null;
  await readStream(second, async (count) => {
    if (count === 2 && !resumed) {
      const response = await fetch(`${base}/api/chat/${id}/stream`, { headers: cookie("anna") });
      resumed = { status: response.status, body: response.status === 200 ? readStream(response) : null };
    }
  });
  const resumedBody = resumed?.body ? await resumed.body : null;
  check(resumed?.status === 200 && resumedBody.text.includes('"type":"finish"'), `${label} GET …/stream подключается к идущему ответу и дочитывает`);

  // 3. Остановка.
  const third = await fetch(`${base}/api/chat/${id}/messages`, { method: "POST", headers: { ...cookie("anna"), ...json }, body: userMessage("u3", "Стоп") });
  let stopStatus = null;
  await readStream(third, async (count) => {
    if (count === 2 && stopStatus === null) {
      stopStatus = (await fetch(`${base}/api/chat/${id}/stop`, { method: "POST", headers: cookie("anna") })).status;
    }
  });
  check(stopStatus === 202, `${label} POST …/stop принят (202)`);
  const afterStop = await (await fetch(`${base}/api/chat/${id}`, { headers: cookie("anna") })).json();
  check(afterStop.running === false && afterStop.messages.at(-1)?.metadata?.status === "stopped", `${label} ответ остановлен, в истории статус stopped`);

  // 4. Чужой пользователь.
  const foreign = await fetch(`${base}/api/chat/${id}`, { headers: cookie("boris") });
  check(foreign.status === 404, `${label} чужой пользователь получает 404`);

  // 5. История свежая, не из кэша.
  const before = await (await fetch(`${base}/api/chat/${id}`, { headers: cookie("anna") })).json();
  await (await fetch(`${base}/api/chat/${id}/messages`, { method: "POST", headers: { ...cookie("anna"), ...json }, body: userMessage("u4", "Ещё раз") })).text();
  const later = await (await fetch(`${base}/api/chat/${id}`, { headers: cookie("anna") })).json();
  check(later.messages.length === before.messages.length + 2, `${label} история после нового сообщения свежая (${before.messages.length} → ${later.messages.length})`);
}

function samplePdf() {
  const lines=["Next SDK PDF worker probe"];
  const escape = (text) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const stream = `BT /F1 14 Tf 72 720 Td 16 TL ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}


async function main() {
  console.log("сборка примера…");
  await build();
  for (const mode of ["start", "dev"]) {
    const server = await startServer(mode);
    try {
      await scenario(mode, server.base);
      check(!/Critical dependency:|Invalid hook call/.test(server.output()), `[${mode}] no critical webpack or React warnings`);
    } finally {
      server.stop();
    }
  }
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\nНе прошло: ${failures.length}`);
      process.exit(1);
    }
    console.log("\nВсе проверки Next.js прошли.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
