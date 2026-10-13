#!/usr/bin/env node
// Живые тесты: `pnpm test:live имя` запускает только файлы с «имя» в пути, без имени — все. Разделитель `--`
// (`pnpm test:live -- имя`) отбрасывается: vitest после него фильтр не читает и запускал все платные тесты.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const separator = args.indexOf("--");
if (separator !== -1) args.splice(separator, 1);
const result = spawnSync("vitest", ["run", "--project", "live", "--silent=false", ...args], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
