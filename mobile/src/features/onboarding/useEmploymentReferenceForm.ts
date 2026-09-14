import { useMemo, useState } from 'react';
import { defaultEmploymentReference, validateEmploymentReference, type EmploymentReference, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';

const FORM_DATA_KEY = 'employmentReferences';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function readStored(formData: Record<string, unknown> | undefined, stepId: string): EmploymentReference {
  const references = (formData?.[FORM_DATA_KEY] ?? {}) as Record<string, Partial<EmploymentReference> | undefined>;
  return { ...defaultEmploymentReference, ...(references[stepId] ?? {}) };
}

/**
 * Form-state + save/conflict logic for a single Employment Reference step
 * (employment_ref_1/2/3 all share this exact shape — only which packet step
 * id is being edited differs, passed in as `stepId`). Deliberately mirrors
 * usePersonalInfoForm's structure (same save/validation-timing/conflict
 * pattern) rather than being unified with it into a generic hook — see
 * ADR-020 for why that generalization still isn't justified after a second
 * real form.
 *
 * The one real difference from Personal Information: this step's data lives
 * one level deeper in formData — `employmentReferences[stepId]`, a record
 * shared across up to 3 reference steps — so saving must preserve every
 * OTHER reference's data, not just every other step's data. stepPatch.ts's
 * existing full-formData spread already protects the OUTER level; this hook
 * handles the inner one by always re-spreading the current
 * `employmentReferences` record before substituting its own key.
 *
 * This does not introduce any new concurrency risk: the session's
 * `revision` check is a single counter for the whole session row, not
 * scoped per formData key or per nested key — a concurrent write to a
 * DIFFERENT reference step (e.g. employment_ref_2 from another device)
 * bumps that same counter, so this hook's own save is rejected with the
 * same 409 it would get for any other conflicting write, and the resulting
 * fresh session (fetched via the conflict path) carries the other device's
 * data forward on the next retry. No additional protection is needed.
 */
export function useEmploymentReferenceForm(stepId: string) {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<EmploymentReference>(() => readStored(session?.formData, stepId));
  const [touched, setTouched] = useState<Partial<Record<keyof EmploymentReference, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: EmploymentReference } | null>(null);

  const isCompleted = session?.stepStates[stepId] === 'completed';

  // Full validity, independent of what's been touched — see usePersonalInfoForm.
  const errors = useMemo<FieldErrors>(() => validateEmploymentReference(data), [data]);

  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  function setField<K extends keyof EmploymentReference>(field: K, value: EmploymentReference[K]): void {
    setData((d) => ({ ...d, [field]: value }));
    setIsDirty(true);
  }

  function blurField(field: keyof EmploymentReference): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  /** Re-spreads the current session's full employmentReferences record so a
   * save here never wipes any OTHER reference step's already-saved data. */
  function mergedReferences(next: EmploymentReference): Record<string, unknown> {
    const existing = (session?.formData?.[FORM_DATA_KEY] ?? {}) as Record<string, unknown>;
    return { ...existing, [stepId]: next };
  }

  function handleResult(result: SaveStepResult): SubmitOutcome {
    if (result.status === 'saved') {
      setIsDirty(false);
      return { kind: 'saved' };
    }
    if (result.status === 'conflict') {
      setConflict({ latest: readStored(result.latestSession.formData, stepId) });
      return { kind: 'conflict' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently typed, no validation gate. Never
   * downgrades an already-'completed' step back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: mergedReferences(data),
      stepId,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every field's error and blocks the save entirely if anything
   * is invalid — never marks complete merely because the applicant opened
   * the screen or typed something. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(defaultEmploymentReference));
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: mergedReferences(data), stepId, status: 'completed' });
    setIsCompleting(false);
    return handleResult(result);
  }

  /** Conflict resolution, option A: keep my in-progress edits and dismiss
   * the notice — the next Save/Complete tap retries against the fresh
   * revision automatically. */
  function keepMyChanges(): void {
    setConflict(null);
  }

  /** Conflict resolution, option B: discard my edits and load the server's
   * latest value for this specific reference. */
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
