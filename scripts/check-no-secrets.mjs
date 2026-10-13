#!/usr/bin/env node
// Проверка SC-007: в сборке демо для браузера нет ключей провайдеров и их адресов.
// Проверяет папку из первого аргумента (так её зовёт Playwright после своей сборки) или, без аргумента,
// собирает apps/demo/dist. Ищет в каждом файле значения DEEPSEEK_API_KEY, FIREWORKS_API_KEY,
// TOGETHER_API_KEY, OPENROUTER_API_KEY, FIRECRAWL_API_KEY, SONIOX_API_KEY и ELEVENLABS_API_KEY (из окружения и .env.local) и адреса
// api.deepseek.com, api.fireworks.ai, api.together.xyz, openrouter.ai, api.firecrawl.dev, api.soniox.com, api.elevenlabs.io.
// Адрес WebSocket Soniox (stt-rt.soniox.com) в сборке допустим: его браузеру отдаёт сервер и он нужен для диктовки.
// Значения ключей не выводятся.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyNames = ["DEEPSEEK_API_KEY", "FIREWORKS_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "SONIOX_API_KEY", "ELEVENLABS_API_KEY"];
const providerHosts = ["api.deepseek.com", "api.fireworks.ai", "api.together.xyz", "openrouter.ai", "api.firecrawl.dev", "api.soniox.com", "api.elevenlabs.io"];

function localEnv() {
  const file = join(root, ".env.local");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

const distFolder = process.argv[2] ?? join(root, "apps/demo/dist");
if (!process.argv[2]) {
  execFileSync("pnpm", ["--filter", "@ykurilov/agent-chat-demo", "exec", "vite", "build", "--logLevel", "warn"], {
    cwd: root,
    stdio: "inherit",
  });
}

const env = { ...localEnv(), ...process.env };
const secrets = keyNames.flatMap((name) => (env[name] ? [{ label: `значение ${name}`, text: env[name] }] : []));
const missingKeys = keyNames.filter((name) => !env[name]);
const needles = [...secrets, ...providerHosts.map((host) => ({ label: `адрес ${host}`, text: host }))];

const files = readdirSync(distFolder, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name));
if (files.length === 0) {
  console.error(`check-no-secrets: в ${distFolder} нет файлов — нечего проверять`);
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const content = readFileSync(file, "latin1");
  for (const needle of needles) {
    if (content.includes(needle.text)) problems.push(`${relative(root, file)}: ${needle.label}`);
  }
}

if (problems.length > 0) {
  console.error(`check-no-secrets: в сборке для браузера найдено — ${problems.length}`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
const skipped = missingKeys.length > 0 ? `; ключей ${missingKeys.join(", ")} нет в окружении — их значения не искались` : "";
console.log(`check-no-secrets: ${files.length} файлов сборки без ключей и адресов провайдеров${skipped}`);
