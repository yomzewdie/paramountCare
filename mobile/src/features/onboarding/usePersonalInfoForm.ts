import { useMemo, useState } from 'react';
import { defaultFormData, validatePersonalInfo, type PersonalInfo, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';

const STEP_ID = 'personal_info';
const FORM_DATA_KEY = 'personalInfo';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function readStored(formData: Record<string, unknown> | undefined): PersonalInfo {
  const stored = (formData?.[FORM_DATA_KEY] ?? {}) as Partial<PersonalInfo>;
  return { ...defaultFormData.personalInfo, ...stored };
}

/**
 * Form-state + save/conflict logic for the Personal Information step. Not a
 * generic "useStepForm<T>" — this is the FIRST step form, and generalizing
 * the field-state shape from a single example risks guessing wrong about
 * what I-9/W-4/employment-reference forms (file uploads, signatures,
 * multiple instances) will actually need. What genuinely IS reusable —
 * the merge-safe save operation (stepPatch.ts) and the conflict-handling
 * shape (SaveStepResult) — already lives in SessionContext/stepPatch, not
 * duplicated here.
 */
export function usePersonalInfoForm() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<PersonalInfo>(() => readStored(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<keyof PersonalInfo, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: PersonalInfo } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  // Full validity, independent of what's been touched — always the true
  // state, used both to decide whether Complete may proceed and (via
  // `visibleErrors` below) to decide what to actually show.
  const errors = useMemo<FieldErrors>(() => validatePersonalInfo(data), [data]);

  // Lightweight-when-useful, not irritating-by-default (M5 instructions §6):
  // a field's error is only shown once the applicant has actually left it,
  // never pre-emptively on load or mid-typing in an untouched field.
  const visibleErrors = useMemo<FieldErrors>(() => {
    const out: FieldErrors = {};
    for (const key of Object.keys(errors)) {
      if (touched[key as keyof PersonalInfo]) out[key] = errors[key];
    }
    return out;
  }, [errors, touched]);

  function setField(field: keyof PersonalInfo, value: string): void {
    setData((d) => ({ ...d, [field]: value }));
    setIsDirty(true);
  }

  function blurField(field: keyof PersonalInfo): void {
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
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently typed, no validation gate — a draft
   * save is deliberately lenient (M5 instructions §5A); only "complete"
   * enforces full validation. Never downgrades an already-'completed' step
   * back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: data,
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every field's error (not just touched ones) and blocks the
   * save entirely if anything is invalid — a step is never marked complete
   * merely because the applicant opened it or typed something. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(Object.fromEntries(Object.keys(defaultFormData.personalInfo).map((k) => [k, true])) as Partial<Record<keyof PersonalInfo, boolean>>);
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: data, stepId: STEP_ID, status: 'completed' });
    setIsCompleting(false);
    return handleResult(result);
  }

  /** Conflict resolution, option A: keep my in-progress edits and dismiss
   * the notice — SessionContext already holds the fresh revision (saveStep
   * updates it even on conflict), so the applicant's very next Save/Complete
   * tap retries against the correct revision automatically. */
  function keepMyChanges(): void {
    setConflict(null);
  }

  /** Conflict resolution, option B: discard my edits and load what the
   * server actually has. */
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
    blurField,
    errors: visibleErrors,
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
