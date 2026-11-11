/*
 * Проверка для `pnpm test:next`: пакеты с миграциями собираются бандлером Next.js (Turbopack и webpack) без
 * `serverExternalPackages` и находят свою папку миграций на диске. Открывает каждое хранилище SQLite в новом файле
 * и, если задан `STORAGE_PROBE_POSTGRES_URL`, каждое хранилище PostgreSQL; первое обращение приводит таблицы к последней миграции.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteTaskStore } from "@ykurilov/agent-chat-background/sqlite";
import { postgresTaskStore } from "@ykurilov/agent-chat-background/postgres";
import { sqliteFlowStore } from "@ykurilov/agent-chat-flows/sqlite";
import { postgresFlowStore } from "@ykurilov/agent-chat-flows/postgres";
import { sqliteImageJobStore } from "@ykurilov/agent-chat-images/sqlite";
import { postgresImageJobStore } from "@ykurilov/agent-chat-images/postgres";
import { createSqliteMcpStore } from "@ykurilov/agent-chat-mcp/sqlite";
import { createPostgresMcpStore } from "@ykurilov/agent-chat-mcp/postgres";
import { createSqliteMessengerStore } from "@ykurilov/agent-chat-messengers/sqlite";
import { createPostgresMessengerStore } from "@ykurilov/agent-chat-messengers/postgres";
import { createSqliteSandboxJournal } from "@ykurilov/agent-chat-sandbox/sqlite";
import { createPostgresSandboxJournal } from "@ykurilov/agent-chat-sandbox/postgres";
import { sqliteSkillStore } from "@ykurilov/agent-chat-skills/sqlite";
import { postgresSkillStore } from "@ykurilov/agent-chat-skills/postgres";
import { createPostgresChatStorage } from "@ykurilov/agent-chat-storage-postgres";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import pg from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Probe = () => Promise<unknown>;

async function runProbes(probes: Record<string, Probe>): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const [name, probe] of Object.entries(probes)) {
    try {
      await probe();
      results[name] = "ok";
    } catch (error) {
      results[name] = error instanceof Error ? error.message : String(error);
    }
  }
  return results;
}

function sqliteProbes(): Record<string, Probe> {
  const file = (name: string) => join(mkdtempSync(join(tmpdir(), "next-storage-probe-")), `${name}.sqlite`);
  return {
    "storage-sqlite": async () => createSqliteChatStorage({ filePath: file("chat") }).close(),
    "background/sqlite": () => sqliteTaskStore(file("background")).get("owner", "task"),
    "flows/sqlite": () => sqliteFlowStore(file("flows")).getChat("chat"),
    "images/sqlite": () => sqliteImageJobStore(file("images")).get("job"),
    "mcp/sqlite": async () => {
      const store = createSqliteMcpStore({ filePath: file("mcp") });
      await store.listServers();
      store.close();
    },
    "messengers/sqlite": async () => (await createSqliteMessengerStore({ filePath: file("messengers") })).close?.(),
    "sandbox/sqlite": async () => (await createSqliteSandboxJournal({ filePath: file("sandbox") })).listForChat("chat"),
    "skills/sqlite": () => sqliteSkillStore(file("skills")).list(),
  };
}

function postgresProbes(connectionString: string, pool: pg.Pool): Record<string, Probe> {
  return {
    "storage-postgres": async () => (await createPostgresChatStorage({ connectionString, poolSize: 1 })).close(),
    "background/postgres": () => postgresTaskStore(pool).get("owner", "task"),
    "flows/postgres": () => postgresFlowStore(pool).getChat("chat"),
    "images/postgres": () => postgresImageJobStore(pool).get("job"),
    "mcp/postgres": () => createPostgresMcpStore({ pool }).listServers(),
    "messengers/postgres": async () => (await createPostgresMessengerStore({ connectionString, poolSize: 1 })).close?.(),
    "sandbox/postgres": async () => (await createPostgresSandboxJournal({ connectionString, poolSize: 1 })).listForChat("chat"),
    "skills/postgres": () => postgresSkillStore(pool).list(),
  };
}

export async function GET(): Promise<Response> {
  const results = await runProbes(sqliteProbes());
  const connectionString = process.env.STORAGE_PROBE_POSTGRES_URL;
  if (connectionString) {
    const pool = new pg.Pool({ connectionString, max: 1 });
    try {
      Object.assign(results, await runProbes(postgresProbes(connectionString, pool)));
    } finally {
      await pool.end();
    }
  }
  return Response.json(results);
}
