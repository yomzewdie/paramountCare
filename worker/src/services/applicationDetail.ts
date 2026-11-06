// The submitted application as an admin reads it. Storage locations never
// leave the Worker: files are fetched by document id through the protected
// routes. What the portal needs from the snapshot's file references — which
// field an older file without a recorded doc type belongs to, for its label —
// is worked out here instead.

const STORAGE_KEY_FIELDS = new Set(['objectKey', 'object_key']);

/** The submitted snapshot with every storage location removed, at any depth.
 * The snapshot itself (applications.payload_json) is never changed. */
export function withoutStorageKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutStorageKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !STORAGE_KEY_FIELDS.has(key))
        .map(([key, v]) => [key, withoutStorageKeys(v)]),
    );
  }
  return value;
}

const objectKeyOf = (file: unknown): string | null => {
  const key = file && typeof file === 'object' ? (file as { objectKey?: unknown }).objectKey : null;
  return typeof key === 'string' && key ? key : null;
};

/** Which snapshot field references each stored file, e.g. 'resumeDocument',
 * 'uploadedDocuments.listA', 'vaccineProofDocuments.hep_b_declination'. */
export function payloadReferences(payload: unknown): Map<string, string> {
  const refs = new Map<string, string>();
  if (!payload || typeof payload !== 'object') return refs;
  const p = payload as Record<string, unknown>;
  const add = (file: unknown, ref: string) => {
    const key = objectKeyOf(file);
    if (key && !refs.has(key)) refs.set(key, ref);
  };
  add(p.resumeDocument, 'resumeDocument');
  add(p.directDepositProofDocument, 'directDepositProofDocument');
  for (const field of ['uploadedDocuments', 'vaccineProofDocuments'] as const) {
    const group = p[field];
    if (group && typeof group === 'object') {
      for (const [slot, file] of Object.entries(group as Record<string, unknown>)) add(file, `${field}.${slot}`);
    }
  }
  return refs;
}
