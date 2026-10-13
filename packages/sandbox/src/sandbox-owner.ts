/** Песочные чаты админа записаны на отдельного владельца: боевой список, лимиты и траты их не видят. */
const SANDBOX_OWNER_PREFIX = "sandbox:";

/** Владелец песочных чатов админа. */
export function sandboxOwnerOf(adminId: string): string {
  return SANDBOX_OWNER_PREFIX + adminId;
}

/** Чат или трата из песочницы: отчёты приложения отделяют их по владельцу. */
export function isSandboxOwner(ownerId: string): boolean {
  return ownerId.startsWith(SANDBOX_OWNER_PREFIX);
}

/** Настоящий id админа за песочным владельцем; обычный владелец остаётся как есть. */
export function realOwnerOf(ownerId: string): string {
  return isSandboxOwner(ownerId) ? ownerId.slice(SANDBOX_OWNER_PREFIX.length) : ownerId;
}
