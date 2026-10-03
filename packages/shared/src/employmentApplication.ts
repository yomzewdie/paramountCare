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

/** Canonical applicant position — `positionApplied`. Drives the CNA rule. */
export const POSITION_OPTIONS: readonly FieldOption[] = [
  { value: 'CNA', label: 'CNA' },
  { value: 'LVN', label: 'LVN' },
  { value: 'RN', label: 'RN' },
  { value: 'NP', label: 'NP' },
];

/** The one position that is never asked for a clinical unit preference. */
export const POSITION_WITHOUT_UNIT_PREFERENCE = 'CNA';

/** Clinical units — `specialtyPreference` (multi-select). Also the base of
 * PRIMARY_SPECIALTY_OPTIONS, so a new unit appears in both places. */
export const CLINICAL_UNIT_OPTIONS: readonly FieldOption[] = [
  { value: 'med_surg', label: 'Med-Surg' },
  { value: 'tele_dou', label: 'Tele-DOU' },
  { value: 'icu', label: 'ICU' },
  { value: 'er', label: 'ER' },
  { value: 'pacu', label: 'PACU' },
  { value: 'sds', label: 'SDS' },
  { value: 'or', label: 'OR' },
  { value: 'gi_lab', label: 'GI Lab' },
  { value: 'anesthesia_tech', label: 'Anesthesia Tech.' },
  { value: 'l_and_d', label: 'L&D' },
];

export const PRIMARY_SPECIALTY_OTHER = 'other';

/** `primarySpecialty` (single-select). "Other" requires `primarySpecialtyOther`. */
export const PRIMARY_SPECIALTY_OPTIONS: readonly FieldOption[] = [
  ...CLINICAL_UNIT_OPTIONS,
  { value: PRIMARY_SPECIALTY_OTHER, label: 'Other' },
];

/** `employmentType` (single-select) — the only values accepted for new input. */
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

export const defaultEmploymentApplicationData: EmploymentApplicationData = {
  positionApplied: '',
  specialtyPreference: [],
  shiftPreference: [],
  employmentType: '',
  availableStartDate: '',
  licenseType: '',
  licenseNumber: '',
  licenseState: '',
  licenseExpiration: '',
  hasCPR: false,
  cprCertNumber: '',
  cprExpiration: '',
  yearsExperience: '',
  primarySpecialty: '',
  primarySpecialtyOther: '',
  currentlyEmployed: null,
  previouslyWorkedHere: null,
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
 *  - legacy free-text primarySpecialty that matches no option → "Other"
 *    with the original text moved into primarySpecialtyOther (only if
 *    that field is empty), so the applicant's answer is preserved;
 *  - legacy positionApplied / employmentType values that aren't allowed
 *    choices are kept as-is (validation rejects them; the applicant must
 *    re-select).
 * Unknown extra keys are passed through untouched.
 */
export function normalizeEmploymentApplication(raw: unknown): EmploymentApplicationData {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const merged = { ...defaultEmploymentApplicationData, ...stored } as EmploymentApplicationData & Record<string, unknown>;

  let primarySpecialty = normalizeSingleSelect(stored.primarySpecialty, PRIMARY_SPECIALTY_OPTIONS);
  let primarySpecialtyOther = typeof stored.primarySpecialtyOther === 'string' ? stored.primarySpecialtyOther : '';
  if (primarySpecialty && !isOptionValue(PRIMARY_SPECIALTY_OPTIONS, primarySpecialty)) {
    if (!primarySpecialtyOther.trim()) primarySpecialtyOther = primarySpecialty;
    primarySpecialty = PRIMARY_SPECIALTY_OTHER;
  }

  return {
    ...merged,
    positionApplied: normalizeSingleSelect(stored.positionApplied, POSITION_OPTIONS),
    specialtyPreference: normalizeMultiSelect(stored.specialtyPreference, CLINICAL_UNIT_OPTIONS),
    shiftPreference: normalizeMultiSelect(stored.shiftPreference, SHIFT_PREFERENCE_OPTIONS),
    employmentType: typeof stored.employmentType === 'string' ? stored.employmentType : '',
    primarySpecialty,
    primarySpecialtyOther,
  };
}

/** Removes multi-select entries that aren't current options — for an
 * editing UI, where an unrecognized value could never be seen or
 * deselected by the applicant. Validation itself still rejects them. */
export function dropUnknownSelections(data: EmploymentApplicationData): EmploymentApplicationData {
  return {
    ...data,
    specialtyPreference: data.specialtyPreference.filter((v) => isOptionValue(CLINICAL_UNIT_OPTIONS, v)),
    shiftPreference: data.shiftPreference.filter((v) => isOptionValue(SHIFT_PREFERENCE_OPTIONS, v)),
  };
}

/** True when the applicant's (canonical) position is asked for a unit preference. */
export function requiresUnitPreference(positionApplied: string): boolean {
  return positionApplied !== POSITION_WITHOUT_UNIT_PREFERENCE;
}

/**
 * The applicant's FINAL answers, as they should appear in a submitted
 * application. In-progress sessions deliberately keep harmless hidden state
 * (unit selections made before switching to CNA, Other text typed before
 * picking a listed specialty) so switching back restores it — but that
 * hidden state is not the applicant's answer and must not be submitted.
 */
export function finalizeEmploymentApplication(raw: unknown): EmploymentApplicationData {
  const data = normalizeEmploymentApplication(raw);
  return {
    ...data,
    specialtyPreference: requiresUnitPreference(data.positionApplied) ? data.specialtyPreference : [],
    primarySpecialtyOther: data.primarySpecialty === PRIMARY_SPECIALTY_OTHER ? data.primarySpecialtyOther : '',
  };
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
