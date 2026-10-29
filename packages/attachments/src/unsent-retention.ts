/** Server policy for files not yet committed to a message. null disables age-based deletion. */
export function resolveUnsentRetentionMs(value: number | null | undefined): number | null {
  if (value === null) return null;
  if (value === undefined) return 24 * 60 * 60_000;
  if (!Number.isFinite(value) || value <= 0) throw new TypeError("unsentRetentionMs: expected a positive finite duration or null");
  return value;
}
