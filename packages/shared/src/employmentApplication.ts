import type { EmploymentApplicationData } from './onboarding';

// ── Employment Application option lists (UAT feedback) ───────────────────────
//
// The single source of truth for every fixed-choice Employment Application
// field. Mobile, the legacy web demo, validation, completion, the Worker's
// submission snapshot, and the Admin Portal all read these lists — adding a
// unit/specialty in the future is a one-line change here, never a hunt
// through individual screens.
//
// Stored values are stable codes (never display labels) so a label can be
// reworded later without invalidating anything already saved.

export interface FieldOption {
  value: string;
  label: string;
}

/** Canonical applicant position — `positionApplied`. Drives which
 * Specialty / Unit Preference options apply (and the CNA rule). Position
 * does NOT select the onboarding packet — every applicant currently gets the
 * same packet (see packets.ts / DEFAULT_PACKET_ID). */
export const POSITION_OPTIONS: readonly FieldOption[] = [
  { value: 'CNA', label: 'CNA' },
  { value: 'Tech', label: 'Tech' },
  { value: 'LVN', label: 'LVN' },
  { value: 'RN', label: 'RN' },
  { value: 'NP', label: 'NP' },
];

/** `licenseType` — the license/certification the applicant holds, on the
 * same taxonomy as POSITION_OPTIONS (same codes) so the two always line up.
 * Legacy 'other' stays readable via LEGACY_LICENSE_TYPE_LABELS but is no
 * longer offered or accepted. */
export const LICENSE_TYPE_OPTIONS: readonly FieldOption[] = [
  { value: 'CNA', label: 'CNA — Certified Nursing Assistant' },
  { value: 'Tech', label: 'Tech — Allied Health Technician / Technologist' },
  { value: 'LVN', label: 'LVN — Licensed Vocational Nurse' },
  { value: 'RN', label: 'RN — Registered Nurse' },
  { value: 'NP', label: 'NP — Nurse Practitioner' },
];

export const LEGACY_LICENSE_TYPE_LABELS: Readonly<Record<string, string>> = {
  other: 'Other',
};

/** The one position that is never asked for a Specialty / Unit Preference. */
export const POSITION_WITHOUT_UNIT_PREFERENCE = 'CNA';

/** The canonical `specialtyPreference` value for a CNA (never an empty list). */
export const CNA_SPECIALTY = 'cna';

/** Every Specialty / Unit code with its label — the display catalog for
 * `specialtyPreference` (applicant-selected, where they WANT to work).
 * Which codes a position may choose is SPECIALTY_CODES_BY_POSITION.
 * Codes are stable; labels may be reworded. */
export const SPECIALTY_OPTIONS: readonly FieldOption[] = [
  { value: CNA_SPECIALTY, label: 'CNA' },
  // Tech
  { value: 'cst', label: 'Certified Surgical Tech (CST)' },
  { value: 'anesthesia_tech', label: 'Anesthesia Tech' },
  { value: 'ct_tech', label: 'CT Tech' },
  { value: 'xray_tech', label: 'X-Ray Tech' },
  { value: 'rrt', label: 'Registered Respiratory Therapist' },
  { value: 'emt', label: 'EMT' },
  // Nursing units
  { value: 'med_surg', label: 'Med-Surg' },
  { value: 'tele_dou', label: 'Tele-DOU' },
  { value: 'icu', label: 'ICU' },
  { value: 'er', label: 'ER' },
  { value: 'or', label: 'OR' },
  { value: 'pacu', label: 'PACU' },
  { value: 'sds', label: 'SDS (Same-Day Surgery)' },
  { value: 'l_and_d', label: 'L&D / Post-Partum' },
  { value: 'nursery_nicu', label: 'Nursery / NICU' },
  { value: 'picu', label: 'PICU' },
  { value: 'cath_lab', label: 'Cath Lab' },
  { value: 'interventional_radiology', label: 'Interventional Radiology' },
  { value: 'gi_lab', label: 'GI Lab' },
  { value: 'acute_dialysis', label: 'Acute Dialysis' },
  { value: 'psychiatric', label: 'Psychiatric' },
];

const RN_NP_SPECIALTIES = [
  'med_surg', 'tele_dou', 'icu', 'er', 'or', 'pacu', 'sds', 'l_and_d', 'nursery_nicu', 'picu',
  'cath_lab', 'interventional_radiology', 'gi_lab', 'acute_dialysis', 'psychiatric',
] as const;

/** Earlier labels of current codes — only for matching legacy free text
 * (e.g. a pre-UAT "L&D" unit preference), never displayed or offered. */
const SPECIALTY_LEGACY_ALIASES: readonly FieldOption[] = [
  { value: 'l_and_d', label: 'L&D' },
  { value: 'sds', label: 'SDS' },
  { value: 'anesthesia_tech', label: 'Anesthesia Tech.' },
];

/** Which specialty codes each position may select, in display order. */
export const SPECIALTY_CODES_BY_POSITION: Readonly<Record<string, readonly string[]>> = {
  CNA: [CNA_SPECIALTY],
  Tech: ['cst', 'anesthesia_tech', 'ct_tech', 'xray_tech', 'rrt', 'emt'],
  LVN: ['med_surg', 'tele_dou', 'er'],
  RN: RN_NP_SPECIALTIES,
  NP: RN_NP_SPECIALTIES,
};

/** @deprecated The full specialty catalog — use specialtyOptionsFor(position)
 * for choices and SPECIALTY_OPTIONS for display. Kept as an alias. */
export const CLINICAL_UNIT_OPTIONS: readonly FieldOption[] = SPECIALTY_OPTIONS;

/** Options the applicant may choose for a position ([] until a position is
 * chosen). A CNA is never shown a choice (see requiresUnitPreference). */
export function specialtyOptionsFor(positionApplied: string): FieldOption[] {
  const codes = SPECIALTY_CODES_BY_POSITION[positionApplied] ?? [];
  return codes.map((code) => SPECIALTY_OPTIONS.find((o) => o.value === code)!);
}

/**
 * The applicant's ACTIVE Specialty / Unit Preference for a position: the
 * stored selections that are valid for it, in display order. A CNA is
 * always exactly [CNA]. Stored selections that belong to another position
 * (e.g. RN units kept after switching to Tech) are draft state — restored if
 * the applicant switches back — and are never active, validated, or
 * submitted.
 */
export function activeSpecialtySelections(positionApplied: string, selections: readonly string[]): string[] {
  if (positionApplied === POSITION_WITHOUT_UNIT_PREFERENCE) return [CNA_SPECIALTY];
  const allowed = SPECIALTY_CODES_BY_POSITION[positionApplied] ?? [];
  return allowed.filter((code) => selections.includes(code));
}

export const PRIMARY_SPECIALTY_OTHER = 'other';

/** Legacy `primarySpecialty` (manual applications only; no longer asked —
 * a clinical specialty is historical experience, which recruiters read from
 * the resume). Kept so historical applications render with labels. */
export const PRIMARY_SPECIALTY_OPTIONS: readonly FieldOption[] = [
  ...SPECIALTY_OPTIONS.filter((o) => o.value !== CNA_SPECIALTY),
  { value: PRIMARY_SPECIALTY_OTHER, label: 'Other' },
];

/** `employmentType` (multi-select — an applicant may want either or both). */
export const EMPLOYMENT_TYPE_OPTIONS: readonly FieldOption[] = [
  { value: 'per_diem_assignment', label: 'Per-Diem Assignment' },
  { value: 'travel_assignment', label: 'Travel Assignment' },
];

/** `shiftPreference` (multi-select). */
export const SHIFT_PREFERENCE_OPTIONS: readonly FieldOption[] = [
  { value: 'am', label: 'AM' },
  { value: 'mid', label: 'MID' },
  { value: 'pm', label: 'PM' },
];

/** Labels for values only older sessions/submissions can contain. Display
 * only — never offered as a choice and never accepted by validation. */
export const LEGACY_EMPLOYMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  full_time: 'Full-Time',
  part_time: 'Part-Time',
  per_diem: 'Per Diem',
};

export const LEGACY_SHIFT_PREFERENCE_LABELS: Readonly<Record<string, string>> = {
  day: 'Day',
  evening: 'Evening',
  night: 'Night',
  any: 'Open to any shift',
};

// ── Option helpers ───────────────────────────────────────────────────────────

export function isOptionValue(options: readonly FieldOption[], value: unknown): value is string {
  return typeof value === 'string' && options.some((o) => o.value === value);
}

/** Loose key for matching legacy free text against an option ("med/surg",
 * "Med-Surg" and "MED SURG" all compare equal). */
function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Matches a stored value to an option code by code or by label, loosely. */
function matchOption(options: readonly FieldOption[], raw: string): string | undefined {
  const key = looseKey(raw);
  if (!key) return undefined;
  return options.find((o) => looseKey(o.value) === key || looseKey(o.label) === key)?.value;
}

/** Display label for one stored value: option label, then legacy label,
 * then the raw value itself (historical free text is shown, not hidden). */
export function optionLabel(
  options: readonly FieldOption[],
  value: string,
  legacyLabels: Readonly<Record<string, string>> = {},
): string {
  return options.find((o) => o.value === value)?.label ?? legacyLabels[value] ?? value;
}

/** Human-readable rendering of a stored single- or multi-value field —
 * accepts both the current array shape and the legacy string shape. Returns
 * '' when nothing is selected. */
export function formatOptionValues(
  value: unknown,
  options: readonly FieldOption[],
  legacyLabels: Readonly<Record<string, string>> = {},
): string {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => optionLabel(options, v, legacyLabels))
    .join(', ');
}

// ── Normalization (backward compatibility) ───────────────────────────────────
//
// `specialtyPreference` and `shiftPreference` were plain strings before UAT
// feedback made them multi-selects; `primarySpecialty` was free text. Stored
// sessions and submitted payloads are never migrated in place — every reader
// goes through this instead, so an old shape can never crash validation or
// completion.

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Coerces a stored multi-select value to string[].
 *  - array (current shape): strings kept; a label matching an option is
 *    mapped to its code; unrecognized entries are KEPT so validation can
 *    reject them (an editing UI may drop them — see dropUnknownSelections).
 *  - string (legacy shape): split on commas/semicolons; only tokens that
 *    match an option are kept (legacy free text was never a selection). */
function normalizeMultiSelect(value: unknown, options: readonly FieldOption[]): string[] {
  if (Array.isArray(value)) {
    return dedupe(
      value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => (isOptionValue(options, v) ? v : matchOption(options, v) ?? v)),
    );
  }
  if (typeof value === 'string') {
    return dedupe(
      value
        .split(/[,;]/)
        .map((token) => matchOption(options, token))
        .filter((v): v is string => !!v),
    );
  }
  return [];
}

/** A stored single-select value that matches an option (by code or label)
 * becomes that code; anything else is returned unchanged so it stays
 * visible to validation (and is never silently discarded). */
function normalizeSingleSelect(value: unknown, options: readonly FieldOption[]): string {
  if (typeof value !== 'string') return '';
  if (!value.trim()) return '';
  return matchOption(options, value) ?? value;
}

/** `employmentType` was a single string before it became a multi-select.
 * A stored string becomes a one-item list; a value that isn't a current
 * option is KEPT (validation rejects it; the applicant re-selects). */
function normalizeEmploymentType(value: unknown): string[] {
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    return [matchOption(EMPLOYMENT_TYPE_OPTIONS, value) ?? value];
  }
  return normalizeMultiSelect(value, EMPLOYMENT_TYPE_OPTIONS);
}

export const defaultEmploymentApplicationData: EmploymentApplicationData = {
  positionApplied: '',
  specialtyPreference: [],
  shiftPreference: [],
  employmentType: [],
  availableStartDate: '',
  licenseType: '',
  licenseNumber: '',
  licenseState: '',
  licenseExpiration: '',
  authorizedToWork: null,
  hasConviction: null,
  convictionDetails: '',
  hasLicenseDiscipline: null,
  licenseDisciplineDetails: '',
  hasLicenseRevocation: null,
  licenseRevocationDetails: '',
  licenseRevocationJurisdiction: '',
  licenseRevocationDate: '',
  underInvestigation: null,
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
};

/**
 * Any stored Employment Application value (current shape, legacy shape, or
 * missing keys) → a fully-shaped EmploymentApplicationData. Never drops data
 * that has a home in the new shape:
 *  - legacy string unit/shift preferences → arrays (matching tokens kept);
 *  - legacy positionApplied / employmentType values that aren't allowed
 *    choices are kept as-is (validation rejects them; the applicant must
 *    re-select).
 * Legacy-only fields (yearsExperience, primarySpecialty, …) are passed
 * through untouched when a stored value has them and never added when it
 * doesn't, so a resume-first application never carries empty leftovers.
 * A legacy free-text primarySpecialty that matches an option is mapped to
 * its code; one that doesn't is moved to "Other" with the original text in
 * primarySpecialtyOther, so the historical answer stays readable.
 */
export function normalizeEmploymentApplication(raw: unknown): EmploymentApplicationData {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const merged = { ...defaultEmploymentApplicationData, ...stored } as EmploymentApplicationData & Record<string, unknown>;

  const normalized: EmploymentApplicationData = {
    ...merged,
    positionApplied: normalizeSingleSelect(stored.positionApplied, POSITION_OPTIONS),
    specialtyPreference: normalizeMultiSelect(stored.specialtyPreference, [...SPECIALTY_OPTIONS, ...SPECIALTY_LEGACY_ALIASES]),
    shiftPreference: normalizeMultiSelect(stored.shiftPreference, SHIFT_PREFERENCE_OPTIONS),
    employmentType: normalizeEmploymentType(stored.employmentType),
  };

  if ('primarySpecialty' in stored) {
    let primarySpecialty = normalizeSingleSelect(stored.primarySpecialty, PRIMARY_SPECIALTY_OPTIONS);
    let primarySpecialtyOther = typeof stored.primarySpecialtyOther === 'string' ? stored.primarySpecialtyOther : '';
    if (primarySpecialty && !isOptionValue(PRIMARY_SPECIALTY_OPTIONS, primarySpecialty)) {
      if (!primarySpecialtyOther.trim()) primarySpecialtyOther = primarySpecialty;
      primarySpecialty = PRIMARY_SPECIALTY_OTHER;
    }
    normalized.primarySpecialty = primarySpecialty;
    normalized.primarySpecialtyOther = primarySpecialtyOther;
  }

  return normalized;
}

/** Removes multi-select entries that aren't in ANY current option list —
 * for an editing UI, where an unrecognized value could never be seen or
 * deselected. Selections valid for a different position are kept (draft
 * state; see activeSpecialtySelections). */
export function dropUnknownSelections(data: EmploymentApplicationData): EmploymentApplicationData {
  return {
    ...data,
    specialtyPreference: data.specialtyPreference.filter((v) => isOptionValue(SPECIALTY_OPTIONS, v)),
    shiftPreference: data.shiftPreference.filter((v) => isOptionValue(SHIFT_PREFERENCE_OPTIONS, v)),
    employmentType: data.employmentType.filter((v) => isOptionValue(EMPLOYMENT_TYPE_OPTIONS, v)),
  };
}

/** True when the applicant's (canonical) position is asked for a unit preference. */
export function requiresUnitPreference(positionApplied: string): boolean {
  return positionApplied !== POSITION_WITHOUT_UNIT_PREFERENCE;
}

/** For saving an in-progress CNA application: makes sure the canonical CNA
 * specialty is stored (never an empty list) while keeping any draft
 * selections from another position. */
export function withCanonicalSpecialty(data: EmploymentApplicationData): EmploymentApplicationData {
  if (data.positionApplied !== POSITION_WITHOUT_UNIT_PREFERENCE || data.specialtyPreference.includes(CNA_SPECIALTY)) return data;
  return { ...data, specialtyPreference: [CNA_SPECIALTY, ...data.specialtyPreference] };
}

/**
 * The applicant's FINAL answers, as they should appear in a submitted
 * application. In-progress sessions deliberately keep harmless draft state
 * (unit selections that belong to a different position, Other text on a
 * legacy specialty) so switching back restores it — but draft state is not
 * the applicant's answer and must not be submitted: the specialty list is
 * exactly the active selections for the final position ([CNA] for a CNA).
 */
export function finalizeEmploymentApplication(raw: unknown): EmploymentApplicationData {
  const data = normalizeEmploymentApplication(raw);
  const finalized: EmploymentApplicationData = {
    ...data,
    specialtyPreference: activeSpecialtySelections(data.positionApplied, data.specialtyPreference),
    employmentType: data.employmentType.filter((v) => isOptionValue(EMPLOYMENT_TYPE_OPTIONS, v)),
  };
  if (data.primarySpecialty !== undefined) {
    finalized.primarySpecialtyOther = data.primarySpecialty === PRIMARY_SPECIALTY_OTHER ? (data.primarySpecialtyOther ?? '') : '';
  }
  return finalized;
}

/** Display text for Primary Clinical Specialty, including the Other text. */
export function formatPrimarySpecialty(primarySpecialty: unknown, primarySpecialtyOther: unknown): string {
  if (typeof primarySpecialty !== 'string' || !primarySpecialty.trim()) return '';
  if (primarySpecialty === PRIMARY_SPECIALTY_OTHER) {
    const other = typeof primarySpecialtyOther === 'string' ? primarySpecialtyOther.trim() : '';
    return other ? `Other — ${other}` : 'Other';
  }
  return optionLabel(PRIMARY_SPECIALTY_OPTIONS, primarySpecialty);
}
