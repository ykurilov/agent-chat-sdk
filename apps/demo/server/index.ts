import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createDemoApp } from "./demo-app";

const model = process.env.DEMO_MODEL === "mock" ? "mock" : "live";
const envFile = fileURLToPath(new URL("../../../.env.local", import.meta.url));
// Ключи провайдеров читаются в окружение процесса и никуда не выводятся.
if (model === "live" && existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.DEMO_API_PORT ?? 8627);
const databaseFile = process.env.DEMO_DB_FILE ?? fileURLToPath(new URL("../demo.sqlite", import.meta.url));
const { app, injectWebSocket, recoverInterruptedAnswers, recoverBackground, startMessengers, flush, close } = await createDemoApp({ databaseFile, model, env: process.env });

// Ответы, которые шли при прошлой остановке сервера, помечаются «прерванными» до приёма запросов.
const interrupted = await recoverInterruptedAnswers();
if (interrupted > 0) console.log(`Помечено прерванными ответов: ${interrupted}`);

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Сервер демо: http://localhost:${port} (модель: ${model === "mock" ? "заглушка" : "настоящая"})`);
  // Боты ходят к серверу по сети (поддельный Telegram — на этом же порту): опрос стартует, когда порт уже слушается.
  void startMessengers().catch((error: unknown) => console.error(error));
});
// Фоновые задачи, брошенные прошлым запуском, подбираются после того, как служба чата готова принимать итоги.
await recoverBackground();

// Голос идёт через сервер по WebSocket: подключаем его к тому же порту.
injectWebSocket(server);

// Штатная остановка: не принимаем запросы, дописываем идущие ответы в базу, закрываем базу.
async function shutdown() {
  server.close();
  await flush();
  close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
