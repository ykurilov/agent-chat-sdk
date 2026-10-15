import { setImmediate as afterQueuedImmediates } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { emptyDatabaseSnapshot } from "./pglite-snapshot";

export interface TemporaryPostgres {
  connectionString: string;
  stop(): Promise<void>;
}

/**
 * Встроенный PostgreSQL (pglite) за обычным сетевым протоколом: адаптер подключается к нему
 * тем же драйвером `pg`, что и к настоящей базе. Каждый вызов — новая пустая база.
 * pglite — база на одно соединение; сервер сокета склеивает несколько подключений в одно (`maxConnections`),
 * поэтому повторное открытие и запросы «сбоку» работают. Блокировки сеанса (`pg_advisory_lock`) при этом общие для
 * всех подключений и ничего не исключают: блокировку миграций проверяет только прогон на настоящем PostgreSQL.
 */
/** `maxConnections` — сколько подключений сервер сокета держит разом (по умолчанию четыре). */
export async function startTemporaryPostgres(options: { maxConnections?: number } = {}): Promise<TemporaryPostgres> {
  const database = await PGlite.create({ loadDataDir: await emptyDatabaseSnapshot() });
  const server = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: options.maxConnections ?? 4 });
  await server.start();
  return {
    connectionString: `postgres://postgres@${server.getServerConn()}/postgres`,
    async stop() {
      // Подключение, которое клиент уже закрыл, сервер сокета отцепляет в своём `setImmediate` и при этом спрашивает базу,
      // открыта ли транзакция: закрыть базу раньше — упасть в его обработчике. Наш `setImmediate` идёт после уже назначенных,
      // а остальные подключения `server.stop()` отцепляет сам в том же проходе цикла событий, пока база открыта.
      await afterQueuedImmediates();
      await server.stop();
      await database.close();
    },
  };
}
