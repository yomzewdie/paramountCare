// Display-safety helpers for the admin application-detail page.

import {
  CLINICAL_UNIT_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  LEGACY_EMPLOYMENT_TYPE_LABELS,
  LEGACY_SHIFT_PREFERENCE_LABELS,
  POSITION_OPTIONS,
  POSITION_WITHOUT_UNIT_PREFERENCE,
  SHIFT_PREFERENCE_OPTIONS,
  formatOptionValues,
  formatPrimarySpecialty,
  isoDateToDisplay,
} from '@pcs/shared';

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

// ── Employment application (curated) ─────────────────────────────────────────
//
// Fixed-choice fields are stored as codes ('per_diem_assignment', ['icu',
// 'l_and_d']) — rendered here with the shared option labels, never as raw
// codes or keys. Submissions made before the UAT field changes hold the old
// shapes (free text, single strings, legacy codes) and are rendered as-is via
// the same helpers; they are never rewritten.

const EMPLOYMENT_APPLICATION_FIELDS: { key: string; label: string; format: (app: Record<string, unknown>) => string }[] = [
  { key: 'positionApplied', label: 'Position Applied For', format: (a) => formatOptionValues(a.positionApplied, POSITION_OPTIONS) },
  {
    key: 'specialtyPreference',
    label: 'Unit Preferences',
    format: (a) => {
      const units = formatOptionValues(a.specialtyPreference, CLINICAL_UNIT_OPTIONS);
      if (units) return units;
      return a.positionApplied === POSITION_WITHOUT_UNIT_PREFERENCE ? 'Not asked (CNA)' : '';
    },
  },
  { key: 'employmentType', label: 'Employment Type', format: (a) => formatOptionValues(a.employmentType, EMPLOYMENT_TYPE_OPTIONS, LEGACY_EMPLOYMENT_TYPE_LABELS) },
  { key: 'shiftPreference', label: 'Shift Preferences', format: (a) => formatOptionValues(a.shiftPreference, SHIFT_PREFERENCE_OPTIONS, LEGACY_SHIFT_PREFERENCE_LABELS) },
  { key: 'availableStartDate', label: 'Available Start Date', format: (a) => (typeof a.availableStartDate === 'string' ? isoDateToDisplay(a.availableStartDate) : '') },
  { key: 'licenseType', label: 'License Type', format: (a) => displayValue('licenseType', a.licenseType) },
  { key: 'licenseNumber', label: 'License Number', format: (a) => displayValue('licenseNumber', a.licenseNumber) },
  { key: 'licenseState', label: 'License State', format: (a) => displayValue('licenseState', a.licenseState) },
  { key: 'licenseExpiration', label: 'License Expiration Date', format: (a) => (typeof a.licenseExpiration === 'string' ? isoDateToDisplay(a.licenseExpiration) : '') },
  { key: 'primarySpecialty', label: 'Primary Clinical Specialty', format: (a) => formatPrimarySpecialty(a.primarySpecialty, a.primarySpecialtyOther) },
];

/** Rendered by its owning row (Primary Clinical Specialty), never on its own. */
const EMPLOYMENT_APPLICATION_CONSUMED_KEYS = new Set(['primarySpecialtyOther']);

/** Curated rows for the employment application: known fields first, with
 * human labels and values; any other field falls back to the generic rows. */
export function employmentApplicationRows(app: Record<string, unknown> | undefined | null): [string, string][] {
  if (!app) return [];
  const known = new Set(EMPLOYMENT_APPLICATION_FIELDS.map((f) => f.key));
  const curated = EMPLOYMENT_APPLICATION_FIELDS.map(({ label, format }): [string, string] => [label, format(app) || '—']);
  const rest = Object.fromEntries(
    Object.entries(app).filter(([k]) => !known.has(k) && !EMPLOYMENT_APPLICATION_CONSUMED_KEYS.has(k)),
  );
  return [...curated, ...flattenForDisplay(rest)];
}

/** Employment reference rows. `reasonForLeaving` is no longer collected
 * (replaced by Supervisor Title) — a historical value is still shown, an
 * empty leftover key is not. */
export function employmentReferenceRows(ref: Record<string, unknown> | undefined | null): [string, string][] {
  if (!ref) return [];
  const { reasonForLeaving, ...rest } = ref;
  const hasReason = typeof reasonForLeaving === 'string' && reasonForLeaving.trim().length > 0;
  return flattenForDisplay(hasReason ? { ...rest, reasonForLeaving } : rest);
}
