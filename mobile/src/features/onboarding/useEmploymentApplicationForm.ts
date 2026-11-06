import { useMemo, useState } from 'react';
import {
  defaultFormData,
  displayDateToIso,
  dropUnknownSelections,
  isoDateToDisplay,
  isoDateToSlash,
  maskDisplayDateInput,
  normalizeEmploymentApplication,
  slashInputToStored,
  validateEmploymentApplication,
  withCanonicalSpecialty,
  type EmploymentApplicationData,
  type FieldErrors,
} from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';
import { isStepValidationRejection } from './serverValidationError';

const STEP_ID = 'employment_application';
const FORM_DATA_KEY = 'employmentApplication';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

/** Multi-select fields in this form. */
export type MultiSelectKey = 'specialtyPreference' | 'primaryClinicalSpecialty' | 'shiftPreference' | 'employmentType';

/** Ordinary (MM/DD/YYYY) date fields in this form. */
export type SlashDateKey = 'availableStartDate' | 'licenseRevocationDate';

/** Reads this step's stored data through the shared normalizer, so a
 * session saved before the UAT changes (string unit/shift preferences,
 * free-text primary specialty, missing new keys) loads safely. Selections
 * that aren't current options are dropped here only because the applicant
 * could never see or deselect them; validation still rejects them if they
 * ever reach the Worker another way. */
function readStored(formData: Record<string, unknown> | undefined): EmploymentApplicationData {
  return dropUnknownSelections(normalizeEmploymentApplication(formData?.[FORM_DATA_KEY]));
}

/**
 * Form-state + save/conflict logic for Employment Application — the
 * earliest real packet step still missing a mobile implementation as of
 * M7 (packages/shared/src/packets.ts: personal_info -> employment_application
 * -> application_statement -> employment_ref_1 -> ...). Same structural
 * shape as usePersonalInfoForm (a single flat formData key, no nested
 * record like employment references), reusing formTouch.ts's
 * touched-reveal helpers exactly as M6 predicted a second form with that
 * same shape would.
 *
 * No signature/attestation handling here: the packet's own
 * `requiresSignature: true` config for this step is not actually wired to
 * anything — validateStep's real dispatch for this subtype calls
 * validateEmploymentApplication() directly (never validateAcknowledgement()),
 * and the existing web renderer shows no signature widget for it either.
 * The real attestation lives in the very next step, `application_statement`
 * (a separate `acknowledgement` step with its own real legal text) — not
 * this milestone's scope.
 */
export function useEmploymentApplicationForm() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<EmploymentApplicationData>(() => readStored(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<keyof EmploymentApplicationData, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: EmploymentApplicationData } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateEmploymentApplication(data), [data]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  function setField<K extends keyof EmploymentApplicationData>(field: K, value: EmploymentApplicationData[K]): void {
    setData((d) => ({ ...d, [field]: value }));
    setIsDirty(true);
    // The minimum depends on the position: an answer already given is
    // re-checked and its message shown the moment the position changes.
    if (field === 'positionApplied' && data.totalYearsExperience.trim()) {
      setTouched((t) => ({ ...t, totalYearsExperience: true }));
    }
  }

  /** Adds or removes one option from a multi-select field. Switching
   * position (e.g. RN → Tech) hides the options that don't apply but keeps
   * them stored as drafts (restored on switching back); only the options
   * valid for the current position are active, validated, and submitted
   * (see activeSpecialtySelections in @pcs/shared). */
  function toggleSelection(field: MultiSelectKey, value: string): void {
    setData((d) => {
      const current = d[field];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...d, [field]: next };
    });
    setIsDirty(true);
  }

  /** License expiration is typed as MM-DD-YYYY but stored canonically as
   * YYYY-MM-DD. A complete, real date is stored in canonical form; anything
   * else (partially typed, or impossible like 02-30-2027) is kept as typed
   * so validation can say exactly what's wrong. */
  function setLicenseExpirationInput(text: string): void {
    const masked = maskDisplayDateInput(text);
    setField('licenseExpiration', displayDateToIso(masked) ?? masked);
  }

  /** Available Start Date / Approximate Date of Action: typed as
   * MM/DD/YYYY (slashes inserted automatically), stored as YYYY-MM-DD. */
  function setSlashDateInput(field: SlashDateKey, text: string): void {
    setField(field, slashInputToStored(text));
  }

  function blurField(field: keyof EmploymentApplicationData): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  function handleResult(result: SaveStepResult): SubmitOutcome {
    if (result.status === 'saved') {
      setIsDirty(false);
      return { kind: 'saved' };
    }
    if (result.status === 'conflict') {
      setConflict({ latest: readStored(result.latestSession.formData) });
      return { kind: 'conflict' };
    }
    if (isStepValidationRejection(result.error) && Object.keys(errors).length > 0) {
      setTouched(touchAll(defaultFormData.employmentApplication));
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently typed, no validation gate. Never
   * downgrades an already-'completed' step back to 'in_progress'. Note:
   * a field hidden by a conditional (e.g. convictionDetails when
   * hasConviction is currently false) is saved as-is, never cleared —
   * matching the existing web implementation, which also never clears a
   * hidden field's underlying value when its condition toggles off. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: withCanonicalSpecialty(data),
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every field's error and blocks the save entirely if anything
   * is invalid — never marks complete merely because the applicant opened
   * the screen or typed something. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(defaultFormData.employmentApplication));
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: withCanonicalSpecialty(data), stepId: STEP_ID, status: 'completed' });
    setIsCompleting(false);
    return handleResult(result);
  }

  /** Conflict resolution, option A: keep my in-progress edits and dismiss
   * the notice — the next Save/Complete tap retries against the fresh
   * revision automatically. */
  function keepMyChanges(): void {
    setConflict(null);
  }

  /** Conflict resolution, option B: discard my edits and load the
   * server's latest values. */
  function discardAndReloadLatest(): void {
    if (!conflict) return;
    setData(conflict.latest);
    setConflict(null);
    setIsDirty(false);
    setTouched({});
  }

  return {
    data,
    setField,
    toggleSelection,
    setLicenseExpirationInput,
    /** Applicant-facing MM-DD-YYYY form of the stored license expiration
     * (License Expiration deliberately keeps dashes, per UAT). */
    licenseExpirationDisplay: isoDateToDisplay(data.licenseExpiration),
    setSlashDateInput,
    /** Applicant-facing MM/DD/YYYY form of a stored ordinary date. */
    slashDateDisplay: (field: SlashDateKey) => isoDateToSlash(data[field]),
    blurField,
    errors: shownErrors,
    isDirty,
    isSaving,
    isCompleting,
    saveError,
    conflict,
    isCompleted,
    saveProgress,
    complete,
    keepMyChanges,
    discardAndReloadLatest,
  };
}
