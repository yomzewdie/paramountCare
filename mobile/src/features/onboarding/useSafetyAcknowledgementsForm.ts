import { useMemo, useState } from 'react';
import { validateSafety, type SafetyEducationData, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { isStepValidationRejection } from './serverValidationError';

const STEP_ID = 'safety_acknowledgements';
const FORM_DATA_KEY = 'safetyEducation';

const EMPTY_DATA: SafetyEducationData = {
  patientSafety: false,
  infectionControl: false,
  fireSafety: false,
  patientRightsHipaa: false,
  workplaceViolence: false,
  backSafety: false,
  hazardousMaterials: false,
  documentationStandards: false,
  examAttestation: false,
};

export const SAFETY_TOPIC_KEYS: (keyof Omit<SafetyEducationData, 'examAttestation'>)[] = [
  'patientSafety',
  'infectionControl',
  'fireSafety',
  'patientRightsHipaa',
  'workplaceViolence',
  'backSafety',
  'hazardousMaterials',
  'documentationStandards',
];

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

/** M15 hardening: `examAttestation` is only ever a truthful statement about
 * the topic set it was given against — if any topic is unchecked after
 * attestation, the attestation must be cleared, not silently carried
 * forward until the applicant explicitly re-attests. Applied here (not
 * just in `toggleTopic`) so a stale `true`/incomplete-topics combination
 * already sitting in stored data — e.g. a session saved before this fix,
 * or a conflict's `latestSession` reflecting someone else's edit — is
 * never trusted as-is on load; every read of stored data goes through
 * this same normalization, so `useState`'s initial value, conflict
 * rehydration, and "discard and reload latest" all get one consistent,
 * authoritative answer instead of three separate ad hoc checks. */
function normalizeAttestation(data: SafetyEducationData): SafetyEducationData {
  const allTopicsChecked = SAFETY_TOPIC_KEYS.every((k) => data[k]);
  if (data.examAttestation && !allTopicsChecked) {
    return { ...data, examAttestation: false };
  }
  return data;
}

function readStored(formData: Record<string, unknown> | undefined): SafetyEducationData {
  const raw = { ...EMPTY_DATA, ...((formData?.[FORM_DATA_KEY] as Partial<SafetyEducationData> | undefined) ?? {}) };
  return normalizeAttestation(raw);
}

/**
 * Form-state + save/conflict logic for the Safety & Education Acknowledgements
 * step (M15). Deliberately NOT built on useAcknowledgementForm/
 * AcknowledgementEntry: the source (frontend/components/onboarding/
 * SafetySection.tsx) models this step as 8 independent topic checkboxes plus
 * one final attestation checkbox — no typed signature, no per-item date,
 * no single combined "checked" boolean. Forcing AcknowledgementEntry's shape
 * onto this data would either lose the 8 topics' independent state or
 * fabricate a signature requirement the source doesn't have. See ADR-028.
 *
 * `touched` is a single flat flag (not per-field) because the shared
 * validator (`validateSafety`) itself only ever produces two possible error
 * keys — `_topics` (one combined message) and `examAttestation` — there is
 * no per-topic error granularity to reveal individually.
 */
export function useSafetyAcknowledgementsForm() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<SafetyEducationData>(() => readStored(session?.formData));
  const [touched, setTouched] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: SafetyEducationData } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateSafety(data), [data]);
  const shownErrors = touched ? errors : {};

  const topicsChecked = SAFETY_TOPIC_KEYS.filter((k) => data[k]).length;
  const totalTopics = SAFETY_TOPIC_KEYS.length;
  const allTopicsChecked = topicsChecked === totalTopics;

  /** Unchecking a topic after the applicant already attested must clear
   * that attestation — it was only ever a truthful statement about the
   * FULL set of 8 topics being checked at the moment it was given, and
   * that no longer holds once one is unchecked. Re-checking the topic
   * afterward (even back to the exact same 8-of-8 set) does not restore
   * the old attestation; the applicant must explicitly attest again. Not
   * mirrored from web (`SafetySection.tsx`'s own `toggle()` has no such
   * reset — see ADR-028 addendum) — added here deliberately to preserve
   * truthful acknowledgement semantics, since silently carrying a stale
   * attestation across a changed topic set would misrepresent what the
   * applicant actually attested to. */
  function toggleTopic(key: (typeof SAFETY_TOPIC_KEYS)[number]): void {
    setData((d) => {
      const next = !d[key];
      return next === false && d.examAttestation ? { ...d, [key]: next, examAttestation: false } : { ...d, [key]: next };
    });
    setIsDirty(true);
  }

  function toggleAttestation(): void {
    setData((d) => ({ ...d, examAttestation: !d.examAttestation }));
    setIsDirty(true);
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
      setTouched(true);
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves whatever is currently checked, no validation gate — matches
   * every other step's partial-save semantics. Never downgrades an
   * already-'completed' step back to 'in_progress'. */
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

  async function complete(): Promise<SubmitOutcome> {
    setTouched(true);
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: data, stepId: STEP_ID, status: 'completed' });
    setIsCompleting(false);
    return handleResult(result);
  }

  function keepMyChanges(): void {
    setConflict(null);
  }

  function discardAndReloadLatest(): void {
    if (!conflict) return;
    setData(conflict.latest);
    setConflict(null);
    setIsDirty(false);
    setTouched(false);
  }

  return {
    data,
    toggleTopic,
    toggleAttestation,
    topicsChecked,
    totalTopics,
    allTopicsChecked,
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
