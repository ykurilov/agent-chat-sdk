// `pnpm release` с Мака: запускает выпуск на GitHub Actions (.github/workflows/release.yml) и ждёт итога.
// Там тот же scripts/release.mjs проходит все шаги на свежей машине: проверки идут всегда заново.
// Настоящий выпуск — из origin/main, поэтому локальный main должен быть запушен и чист.
// `--dry-run` — сухой прогон в Actions на текущей ветке (если она есть на GitHub), иначе на main.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflow = "release.yml";

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Выбор ветки для запуска; строка — причина стопа. */
function chooseRef(dryRun) {
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  capture("git", ["fetch", "--quiet", "origin"]);
  const remoteHead = (ref) => capture("git", ["rev-parse", "--verify", "--quiet", `origin/${ref}`]).out;
  if (dryRun) return { ref: remoteHead(branch) ? branch : "main" };
  if (branch === "main") {
    if (capture("git", ["status", "--porcelain"]).out !== "") {
      return { stop: "В рабочей папке есть незакоммиченные изменения. Выпуск идёт из GitHub: закоммитьте их (вместе с записью в .changeset), git push и запустите снова." };
    }
    if (capture("git", ["rev-parse", "HEAD"]).out !== remoteHead("main")) {
      return { stop: "Локальный main не совпадает с origin/main. Выпуск идёт из GitHub: сделайте git push (или git pull) и запустите снова." };
    }
  } else {
    console.log(`Сейчас ветка ${branch}; выпуск пойдёт из origin/main (${capture("git", ["log", "-1", "--format=%h %s", "origin/main"]).out}).`);
  }
  return { ref: "main" };
}

/** id прогона: из вывода `gh workflow run`, а если его там нет — самый свежий ручной прогон ветки после запуска. */
function findRunId(dispatchOutput, ref, startedAt) {
  const fromOutput = dispatchOutput.match(/\/actions\/runs\/(\d+)/);
  if (fromOutput) return fromOutput[1];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const listed = capture("gh", ["run", "list", "--workflow", workflow, "--branch", ref, "--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt"]);
    const runs = listed.ok ? JSON.parse(listed.out || "[]") : [];
    const fresh = runs.find((run) => Date.parse(run.createdAt) >= startedAt - 10_000);
    if (fresh) return String(fresh.databaseId);
    pause(3_000);
  }
  return null;
}

/** Запуск и ожидание; возвращает код выхода. */
export function releaseInActions(args) {
  const dryRun = args.includes("--dry-run");
  if (args.includes("--full")) console.log("--full не нужен: в Actions проверки и так идут заново.");
  const choice = chooseRef(dryRun);
  if (choice.stop) {
    console.error(`\n✋ ${choice.stop}\n`);
    return 1;
  }

  console.log(`\n▶ Запускаю ${dryRun ? "сухой прогон выпуска" : "выпуск"} на GitHub Actions (ветка ${choice.ref})`);
  const startedAt = Date.now();
  const dispatched = capture("gh", ["workflow", "run", workflow, "--ref", choice.ref, "-f", `dry_run=${dryRun}`]);
  if (!dispatched.ok) {
    console.error(`\n✋ gh workflow run не прошёл: ${dispatched.err}\n   Запасной путь — выпуск с этой машины: pnpm release --local\n`);
    return 1;
  }
  const runId = findRunId(`${dispatched.out}\n${dispatched.err}`, choice.ref, startedAt);
  if (!runId) {
    console.error("\n✋ Прогон запущен, но GitHub не показал его за минуту. Найдите его на вкладке Actions хранилища.\n");
    return 1;
  }
  const url = capture("gh", ["run", "view", runId, "--json", "url", "--jq", ".url"]).out;
  console.log(`Прогон: ${url}`);

  spawnSync("gh", ["run", "watch", runId, "--compact", "--exit-status", "--interval", "30"], { cwd: root, stdio: "inherit" });
  const conclusion = capture("gh", ["run", "view", runId, "--json", "conclusion", "--jq", ".conclusion"]).out;
  if (conclusion === "success") {
    console.log(`\n✅ ${dryRun ? "Сухой прогон выпуска прошёл" : "Выпуск прошёл"}. Прогон: ${url}`);
    if (!dryRun) console.log("   Коммит chore(release) и тег теперь в origin/main: сделайте git pull.");
    return 0;
  }
  const failedLog = capture("gh", ["run", "view", runId, "--log-failed"]).out.split("\n").slice(-60).join("\n");
  if (failedLog) console.error(`\nКонец журнала упавшего шага:\n${failedLog}`);
  console.error(`\n✋ ${dryRun ? "Сухой прогон" : "Выпуск"} не прошёл (${conclusion || "итог неизвестен"}). Прогон: ${url}\n`);
  return 1;
}
