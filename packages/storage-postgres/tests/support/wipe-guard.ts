export const wipeConfirmationVariable = "AGENT_CHAT_TEST_POSTGRES_WIPE";

/**
 * Тесты на настоящем PostgreSQL стирают схему `agent_chat` целиком. Разрешаем это только базе, чьё имя содержит
 * `test`, либо когда владелец явно подтвердил стирание (`AGENT_CHAT_TEST_POSTGRES_WIPE=yes`).
 * Иначе бросаем ошибку: тихий пропуск скрыл бы, что тесты не идут.
 */
export function assertSafeToWipe(connectionString: string, environment: Record<string, string | undefined> = process.env): void {
  if (environment[wipeConfirmationVariable] === "yes") return;
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
  } catch {
    // Адрес не разобрать: имени базы нет, ниже откажем.
  }
  if (/test/i.test(databaseName)) return;
  throw new Error(
    `Тесты стирают схему agent_chat, а имя базы${databaseName ? ` «${databaseName}»` : ""} не содержит «test». ` +
      `Возьмите отдельную тестовую базу или подтвердите стирание: ${wipeConfirmationVariable}=yes`,
  );
}
