// Display-safety helpers for the admin application-detail page.

import {
  EMPLOYMENT_TYPE_OPTIONS,
  LEGACY_EMPLOYMENT_TYPE_LABELS,
  LEGACY_LICENSE_TYPE_LABELS,
  LEGACY_SHIFT_PREFERENCE_LABELS,
  LICENSE_TYPE_OPTIONS,
  POSITION_OPTIONS,
  POSITION_WITHOUT_UNIT_PREFERENCE,
  SHIFT_PREFERENCE_OPTIONS,
  SPECIALTY_OPTIONS,
  VERIFIED_LICENSE_DOC_TYPE,
  formatOptionValues,
  formatPrimarySpecialty,
  formatYearsOfExperience,
  isoDateToDisplay,
  isoDateToSlash,
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

const EMPLOYMENT_APPLICATION_FIELDS: { key: string; label: string; format: (app: Record<string, unknown>) => string; onlyIfStored?: boolean }[] = [
  { key: 'positionApplied', label: 'Position Applied For', format: (a) => formatOptionValues(a.positionApplied, POSITION_OPTIONS) },
  {
    key: 'specialtyPreference',
    label: 'Specialty / Unit Preference (applicant-selected)',
    format: (a) => {
      const units = formatOptionValues(a.specialtyPreference, SPECIALTY_OPTIONS);
      if (units) return units;
      // Applications submitted before CNA had a canonical value stored [].
      return a.positionApplied === POSITION_WITHOUT_UNIT_PREFERENCE ? 'Not asked (CNA)' : '';
    },
  },
  // Applications submitted before these questions existed don't have them.
  { key: 'totalYearsExperience', label: 'Total Years of Professional Experience', format: (a) => formatYearsOfExperience(a.totalYearsExperience), onlyIfStored: true },
  { key: 'primaryClinicalSpecialty', label: 'Primary Clinical Specialty', format: (a) => formatOptionValues(a.primaryClinicalSpecialty, SPECIALTY_OPTIONS), onlyIfStored: true },
  { key: 'employmentType', label: 'Employment Type', format: (a) => formatOptionValues(a.employmentType, EMPLOYMENT_TYPE_OPTIONS, LEGACY_EMPLOYMENT_TYPE_LABELS) },
  { key: 'shiftPreference', label: 'Shift Preferences', format: (a) => formatOptionValues(a.shiftPreference, SHIFT_PREFERENCE_OPTIONS, LEGACY_SHIFT_PREFERENCE_LABELS) },
  { key: 'availableStartDate', label: 'Available Start Date', format: (a) => (typeof a.availableStartDate === 'string' ? isoDateToDisplay(a.availableStartDate) : '') },
  { key: 'licenseType', label: 'License / Certification Type', format: (a) => formatOptionValues(a.licenseType, LICENSE_TYPE_OPTIONS, LEGACY_LICENSE_TYPE_LABELS) },
  { key: 'licenseNumber', label: 'License Number', format: (a) => displayValue('licenseNumber', a.licenseNumber) },
  { key: 'licenseState', label: 'License State', format: (a) => displayValue('licenseState', a.licenseState) },
  { key: 'licenseExpiration', label: 'License Expiration Date', format: (a) => (typeof a.licenseExpiration === 'string' ? isoDateToDisplay(a.licenseExpiration) : '') },
  // Manual (pre-resume) applications only — never asked of resume-based ones.
  { key: 'primarySpecialty', label: 'Primary Clinical Specialty', format: (a) => formatPrimarySpecialty(a.primarySpecialty, a.primarySpecialtyOther), onlyIfStored: true },
];

/** Rendered by its owning row (the legacy specialty), never on its own. */
const EMPLOYMENT_APPLICATION_CONSUMED_KEYS = new Set(['primarySpecialtyOther']);

/** Curated rows for the employment application: known fields first, with
 * human labels and values; any other field falls back to the generic rows.
 * An `onlyIfStored` field appears only when the stored application has it. */
export function employmentApplicationRows(app: Record<string, unknown> | undefined | null): [string, string][] {
  if (!app) return [];
  const known = new Set(EMPLOYMENT_APPLICATION_FIELDS.map((f) => f.key));
  const curated = EMPLOYMENT_APPLICATION_FIELDS
    .filter(({ key, onlyIfStored }) => !onlyIfStored || key in app)
    .map(({ key, label, format }): [string, string] => [
      // An application holding both answers keeps them distinguishable.
      key === 'primarySpecialty' && 'primaryClinicalSpecialty' in app ? `${label} (legacy)` : label,
      format(app) || '—',
    ]);
  const rest = Object.fromEntries(
    Object.entries(app).filter(([k]) => !known.has(k) && !EMPLOYMENT_APPLICATION_CONSUMED_KEYS.has(k)),
  );
  return [...curated, ...flattenForDisplay(rest)];
}

// ── Employment references ─────────────────────────────────────────────────────
//
// Resume-based references are who to contact and permission to contact them.
// Manual (pre-resume) references also carried the employment itself; those
// fields are shown only when the stored reference actually has a value, so a
// resume-based reference never shows empty work-history rows.

const REFERENCE_FIELDS: { key: string; label: string; legacyOnly?: boolean }[] = [
  { key: 'supervisorName', label: 'Supervisor' },
  { key: 'supervisorTitle', label: 'Supervisor Title' },
  { key: 'employerName', label: 'Facility / Employer' },
  { key: 'supervisorPhone', label: 'Supervisor Phone' },
  { key: 'supervisorEmail', label: 'Supervisor Email', legacyOnly: true }, // optional: shown only when provided
  { key: 'permissionGranted', label: 'Permission to Contact' },
  { key: 'positionHeld', label: 'Position Held', legacyOnly: true },
  { key: 'employmentDateFrom', label: 'Employment From', legacyOnly: true },
  { key: 'employmentDateTo', label: 'Employment To', legacyOnly: true },
  { key: 'employerCity', label: 'Employer City', legacyOnly: true },
  { key: 'employerState', label: 'Employer State', legacyOnly: true },
  { key: 'eligibleForRehire', label: 'Eligible for Rehire', legacyOnly: true },
  { key: 'rehireDetails', label: 'Rehire Details', legacyOnly: true },
  { key: 'reasonForLeaving', label: 'Reason for Leaving', legacyOnly: true },
  { key: 'comments', label: 'Comments', legacyOnly: true },
];

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

/** Employment reference rows: the current fields always, legacy/optional
 * fields only when they hold a value, then anything unrecognized. */
export function employmentReferenceRows(ref: Record<string, unknown> | undefined | null): [string, string][] {
  if (!ref) return [];
  const known = new Set(REFERENCE_FIELDS.map((f) => f.key));
  const curated = REFERENCE_FIELDS
    .filter(({ key, legacyOnly }) => !legacyOnly || hasValue(ref[key]))
    .map(({ key, label }): [string, string] => [label, displayValue(key, ref[key])]);
  const rest = Object.fromEntries(Object.entries(ref).filter(([k]) => !known.has(k)));
  return [...curated, ...flattenForDisplay(rest)];
}

// ── Personal details ────────────────────────────────────────────────────────

/** Personal details with the date of birth shown as MM/DD/YYYY. */
export function personalInfoRows(info: Record<string, unknown> | undefined | null): [string, string][] {
  if (!info) return [];
  return flattenForDisplay(info).map(([label, value]): [string, string] =>
    label === 'Date Of Birth' ? ['Date of Birth', typeof info.dateOfBirth === 'string' && info.dateOfBirth ? isoDateToSlash(info.dateOfBirth) : '—'] : [label, value],
  );
}

// ── Application format ──────────────────────────────────────────────────────

export type ApplicationFormat = 'resume' | 'manual';

/** Resume-based applications (every submission since the resume became the
 * "About You & Work History" step) carry a resume; earlier ones were
 * submitted with manually entered work history and never have one. */
export function applicationFormat(
  payload: Record<string, unknown> | null,
  documents: { docType: string | null }[],
): ApplicationFormat {
  const resume = payload?.resumeDocument;
  if (resume && typeof resume === 'object') return 'resume';
  return documents.some((d) => d.docType === 'applicant_resume') ? 'resume' : 'manual';
}

export const APPLICATION_FORMAT_LABELS: Record<ApplicationFormat, string> = {
  resume: 'Resume-based application',
  manual: 'Manual work-history application (legacy)',
};

// ── Documents ───────────────────────────────────────────────────────────────

interface DisplayDocument {
  docType: string | null;
  label: string | null;
}

/** Staff-provided verification, shown apart from what the applicant uploaded. */
export function isVerifiedLicense(doc: Pick<DisplayDocument, 'docType'>): boolean {
  return doc.docType === VERIFIED_LICENSE_DOC_TYPE;
}

/** Documents grouped by requirement, in first-seen order, so several
 * attachments for one requirement read as one item. A document with no label
 * (generated forms, legacy rows) stands alone. */
export function groupDocuments<T extends DisplayDocument>(documents: T[]): { label: string | null; documents: T[] }[] {
  const groups: { label: string | null; documents: T[] }[] = [];
  for (const doc of documents) {
    const existing = doc.label ? groups.find((g) => g.label === doc.label) : undefined;
    if (existing) existing.documents.push(doc);
    else groups.push({ label: doc.label, documents: [doc] });
  }
  return groups;
}
