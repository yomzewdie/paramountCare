// Audit entries as admins read them. The stored metadata is kept whole; what
// leaves the Worker never includes a storage location (e.g. the I-9 PDF's
// object key) — nothing an admin needs, and never something to hand out.

const HIDDEN_KEYS = new Set(['objectKey', 'object_key']);

export function publicAuditMetadata(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([key]) => !HIDDEN_KEYS.has(key)));
  } catch {
    return null;
  }
}
