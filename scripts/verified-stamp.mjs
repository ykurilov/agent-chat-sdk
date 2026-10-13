// Отметка «этот код уже проверен»: `pnpm verify` ставит её после зелёных test, typecheck и build,
// `pnpm release` по ней пропускает повтор тех же проверок.
// Отметка лежит в node_modules/.cache (вне git) и хранит отпечаток кода — хеш содержимого файлов,
// от которых зависят проверки. Хеша коммита в нём нет: незакоммиченные правки учитываются,
// а коммит без правок кода отпечаток не меняет.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stampPath = (root) => join(root, "node_modules", ".cache", "agent-chat-verified.json");

/**
 * Файлы, которые точно не влияют на test, typecheck и build: сводка версий и записи об изменениях
 * (их правят уже после проверки). `.changeset/config.json` сюда не входит: тесты пакетов его читают.
 */
const isIgnoredByChecks = (path) => path === "CHANGES.md" || /^\.changeset\/[^/]+\.md$/.test(path);

/** Файлы под git: отслеживаемые и новые (не из .gitignore), пути от корня, по алфавиту. */
function checkedFiles(root) {
  const listing = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listing.status !== 0) throw new Error(`git ls-files не сработал: ${listing.stderr}`);
  return [...new Set(listing.stdout.split("\0").filter(Boolean))].filter((path) => !isIgnoredByChecks(path)).sort();
}

/** Содержимое файла для хеша; null — файл удалён, но ещё числится в git. */
function contentOf(root, path) {
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    return null;
  }
  return stat.isSymbolicLink() ? `link:${readlinkSync(absolute)}` : readFileSync(absolute);
}

/**
 * Отпечаток кода: хеш путей и содержимого всех файлов, от которых зависят проверки, плюс старшая
 * версия Node (на другой версии результат проверок может быть другим).
 */
export function codeFingerprint(root) {
  const hash = createHash("sha256");
  hash.update(`node:${process.versions.node.split(".")[0]}\n`);
  for (const path of checkedFiles(root)) {
    const content = contentOf(root, path);
    if (content === null) continue;
    hash.update(`${path}\0${createHash("sha256").update(content).digest("hex")}\n`);
  }
  return hash.digest("hex");
}

/** Записывает отметку: код с этим отпечатком прошёл проверки. */
export function writeStamp(root, fingerprint) {
  const path = stampPath(root);
  mkdirSync(join(root, "node_modules", ".cache"), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ fingerprint, verifiedAt: new Date().toISOString() }, null, 2)}\n`);
}

/** Сверяет отметку с текущим кодом: `{ verified, verifiedAt?, reason }`. Любая неясность — не проверено. */
export function checkStamp(root, fingerprint = codeFingerprint(root)) {
  const path = stampPath(root);
  if (!existsSync(path)) return { verified: false, reason: "отметки pnpm verify нет" };
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { verified: false, reason: "отметка pnpm verify повреждена" };
  }
  if (typeof stamp?.fingerprint !== "string" || typeof stamp?.verifiedAt !== "string") {
    return { verified: false, reason: "отметка pnpm verify повреждена" };
  }
  if (stamp.fingerprint !== fingerprint) {
    return { verified: false, verifiedAt: stamp.verifiedAt, reason: "код изменился после pnpm verify" };
  }
  return { verified: true, verifiedAt: stamp.verifiedAt, reason: "код совпадает с проверенным" };
}
