#!/usr/bin/env node
// Проверка планов 026 (T045), 027 (T091, FR-037) и 077: код расширений не попадает в обычную сборку демо-клиента.
// Демо собирается дважды во временные папки:
//   со всем (песочница, мессенджеры, навыки): метки их кода в сборке есть, проверка не слепа;
//   без них, `VITE_DEMO_SANDBOX=0 VITE_DEMO_MESSENGERS=0 VITE_DEMO_SKILLS=0`: меток нет.
// Серверный код фона, мессенджеров и навыков (`serverMarks`) не должен попадать в клиент ни в одной из сборок.
// Метки — надписи и адреса, которые есть только в коде своего расширения. Имена инструментов фона (`check_tasks`)
// меткой быть не могут: их фразы шагов (`@ykurilov/agent-chat-background/labels`) законно идут в клиент.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const extensionMarks = {
  песочница: ["Вернуть боевую", "Открыть журнал", "answer-edit", "journal/calls"],
  мессенджеры: ["Откройте ссылку в мессенджере", "Открыть в мессенджере"],
  навыки: ["Выберите навык слева или создайте новый", "Агент ещё не загружал этот навык"],
};
const serverMarks = ["api.telegram.org", "too_many_tasks", "Фоновые задачи этого чата: название, состояние, ход.", "rerunAfterRestart", "Навыки — готовые указания для отдельных задач"];
const allMarks = [...Object.values(extensionMarks).flat(), ...serverMarks];

function build(withExtensions) {
  const outDir = mkdtempSync(join(tmpdir(), "agent-chat-extension-bundle-"));
  execFileSync("pnpm", ["--filter", "@ykurilov/agent-chat-demo", "exec", "vite", "build", "--logLevel", "error", "--outDir", outDir, "--emptyOutDir"], {
    stdio: "inherit",
    env: { ...process.env, ...(withExtensions ? {} : { VITE_DEMO_SANDBOX: "0", VITE_DEMO_MESSENGERS: "0", VITE_DEMO_SKILLS: "0" }) },
  });
  const text = readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|html|css)$/.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
  rmSync(outDir, { recursive: true, force: true });
  return allMarks.filter((mark) => text.includes(mark));
}

const full = build(true);
const blind = Object.values(extensionMarks)
  .flat()
  .filter((mark) => !full.includes(mark));
if (blind.length > 0) {
  console.error(`В полной сборке нет меток: ${blind.join(", ")}. Проверка слепа, обновите список меток.`);
  process.exit(1);
}
const serverLeak = full.filter((mark) => serverMarks.includes(mark));
if (serverLeak.length > 0) {
  console.error(`Серверный код попал в клиентскую сборку: ${serverLeak.join(", ")}.`);
  process.exit(1);
}
const leaked = build(false);
if (leaked.length > 0) {
  console.error(`Код расширений попал в сборку без них: ${leaked.join(", ")}.`);
  process.exit(1);
}
console.log("Сборка без песочницы, мессенджеров и навыков не содержит их кода; серверного кода в клиенте нет.");
