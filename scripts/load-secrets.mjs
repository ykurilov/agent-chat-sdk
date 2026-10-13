// Пишет ключи провайдеров из ~/.codex/secrets (и ключ Soniox из ~/.config/soniox/.env) в .env.local.
// Ключ ElevenLabs для голосового режима лежит в ~/.codex/secrets/elevenlabs.env.
// Ключ Runware для картинок агента лежит в ~/.claude/secrets/runware.env (формат `export RUNWARE_API_KEY=...`),
// ключ KIE.ai — в ~/.claude/secrets/kie.env (`KIE_API_KEY=...`).
// Значения ключей не выводятся: в консоль идут только имена переменных и файлов.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const secretsDir = join(homedir(), ".codex", "secrets");
const envFile = new URL("../.env.local", import.meta.url);

const keySources = [
  {
    envName: "DEEPSEEK_API_KEY",
    fileOverrideEnv: "DEEPSEEK_API_KEY_FILE",
    defaultFile: join(secretsDir, "deepseek-api-key.txt"),
  },
  {
    envName: "FIREWORKS_API_KEY",
    fileOverrideEnv: "FIREWORKS_API_KEY_FILE",
    // Свой ключ приложения. В ~/.codex/secrets несколько ключей Fireworks от других
    // приложений; скрипт их не угадывает — другой файл задаётся через FIREWORKS_API_KEY_FILE.
    defaultFile: join(secretsDir, "agent-chat-fireworks-api-key.txt"),
  },
  {
    envName: "TOGETHER_API_KEY",
    fileOverrideEnv: "TOGETHER_API_KEY_FILE",
    defaultFile: join(secretsDir, "together-api-key.txt"),
  },
  {
    envName: "OPENROUTER_API_KEY",
    fileOverrideEnv: "OPENROUTER_API_KEY_FILE",
    // Свой ключ приложения «agent-chat-sdk» с лимитом 10 $ в месяц.
    defaultFile: join(secretsDir, "agent-chat-openrouter-api-key.txt"),
  },
  {
    envName: "FIRECRAWL_API_KEY",
    fileOverrideEnv: "FIRECRAWL_API_KEY_FILE",
    defaultFile: join(secretsDir, "firecrawl-api-key.txt"),
  },
  {
    envName: "SONIOX_API_KEY",
    fileOverrideEnv: "SONIOX_API_KEY_FILE",
    // Файл в формате .env: SONIOX_API_KEY=...
    defaultFile: join(homedir(), ".config", "soniox", ".env"),
    parse: (text) => parseEnv(text).SONIOX_API_KEY ?? "",
  },
  {
    envName: "ELEVENLABS_API_KEY",
    fileOverrideEnv: "ELEVENLABS_API_KEY_FILE",
    // Файл в формате .env: ELEVENLABS_API_KEY=...
    defaultFile: join(secretsDir, "elevenlabs.env"),
    parse: (text) => parseEnv(text).ELEVENLABS_API_KEY ?? "",
  },
  {
    envName: "RUNWARE_API_KEY",
    fileOverrideEnv: "RUNWARE_API_KEY_FILE",
    // Файл в формате .env: RUNWARE_API_KEY=... (допустим и префикс `export `). Лежит не в ~/.codex/secrets, а в ~/.claude/secrets.
    defaultFile: join(homedir(), ".claude", "secrets", "runware.env"),
    parse: (text) => parseEnv(text).RUNWARE_API_KEY ?? "",
  },
  {
    envName: "KIE_API_KEY",
    fileOverrideEnv: "KIE_API_KEY_FILE",
    // Файл в формате .env: KIE_API_KEY=... — тоже в ~/.claude/secrets.
    defaultFile: join(homedir(), ".claude", "secrets", "kie.env"),
    parse: (text) => parseEnv(text).KIE_API_KEY ?? "",
  },
];

function readKey({ envName, fileOverrideEnv, defaultFile, parse }) {
  const file = process.env[fileOverrideEnv] || defaultFile;
  if (!existsSync(file)) {
    throw new Error(
      `${envName}: нет файла ${file}. Положите ключ в этот файл или укажите другой через ${fileOverrideEnv}.`,
    );
  }
  const text = readFileSync(file, "utf8");
  const value = (parse ? parse(text) : text).trim();
  if (!value) throw new Error(`${envName}: файл ${file} пустой.`);
  return { file, value };
}

const existing = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const merged = { ...existing };
const problems = [];

for (const source of keySources) {
  try {
    const { file, value } = readKey(source);
    merged[source.envName] = value;
    console.log(`${source.envName} ← ${file}`);
  } catch (error) {
    problems.push(error.message);
  }
}

const body = Object.entries(merged)
  .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
  .join("\n");
writeFileSync(envFile, `${body}\n`, { mode: 0o600 });
console.log("Записано в .env.local");

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
