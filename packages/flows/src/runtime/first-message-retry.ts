/** Ход «пишет первым» не начался или приложение сказало «не сейчас» (`canWriteNow` → `false`): касание — через час. */
export const FIRST_MESSAGE_RETRY_MS = 3_600_000;
/** `canWriteNow` → `{ retryAt }` в прошлом: повтор не чаще, чем раз в минуту. */
export const FIRST_MESSAGE_MIN_RETRY_MS = 60_000;
