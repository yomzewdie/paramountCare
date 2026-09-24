// Display-safety helpers for the admin application-detail page.

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Keys that must never be rendered no matter what the payload contains. The
// Worker already redacts SSN/bank fields when it stores the snapshot
// (services/submission.ts redactSensitiveFormData); this is defense in depth
// so that a future payload change cannot silently start leaking one into the
// admin UI.
const NEVER_RENDER_KEY = /ssn|account ?number|routing ?number|password|token|secret|hash|datauri|dataurl|signatureimage/i;

export const REDACTED = '[hidden]';

/** Human display of any payload value; long data: URIs and sensitive keys are never shown. */
export function displayValue(key: string, val: unknown): string {
  if (NEVER_RENDER_KEY.test(key)) return REDACTED;
  if (val === null || val === undefined || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'string') {
    if (val.startsWith('data:')) return REDACTED;
    return val;
  }
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) return val.length === 0 ? '—' : val.map((v) => displayValue(key, v)).join(', ');
  return REDACTED; // nested objects are flattened by flattenForDisplay, never stringified raw
}

export function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}

/** One level of nesting flattened to "parent › child" rows; deeper levels are summarized, not dumped. */
export function flattenForDisplay(obj: Record<string, unknown> | undefined | null): [string, string][] {
  if (!obj) return [];
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) continue;
        rows.push([`${humanizeKey(k)} › ${humanizeKey(k2)}`, displayValue(k2, v2)]);
      }
    } else {
      rows.push([humanizeKey(k), displayValue(k, v)]);
    }
  }
  return rows;
}
