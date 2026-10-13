// Запускает сервер демо и Vite вместе; Ctrl+C останавливает оба.
import { spawn } from "node:child_process";

const processes = [
  spawn("pnpm", ["exec", "tsx", "watch", "--conditions=@ykurilov/agent-chat-source", "server/index.ts"], { stdio: "inherit" }),
  spawn("pnpm", ["exec", "vite"], { stdio: "inherit" }),
];

function stopAll() {
  for (const child of processes) child.kill("SIGTERM");
}

for (const child of processes) {
  child.on("exit", (code) => {
    stopAll();
    process.exitCode = code ?? 0;
  });
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
