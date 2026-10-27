import { useMemo, useState } from 'react';
import { validateResume, type FieldErrors, type UploadedFile } from '@pcs/shared';
import { useSession } from './SessionContext';
import { useDocumentSlot } from '../documents/useDocumentSlot';
import { RESUME_SLOT } from '../documents/documentSlots';
import { RESUME_REQUIREMENT } from '../documents/documentRequirements';
import { isStepValidationRejection } from './serverValidationError';

const STEP_ID = 'resume';
const FORM_DATA_KEY = 'resumeDocument';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

/**
 * The `resume` step — the entire "About You & Work History" phase. One
 * document slot (`useDocumentSlot`, the same upload → ownership-verified
 * association → replace/remove lifecycle every other document uses), plus
 * the step-level save/complete every step has. The file itself is read
 * straight from the live session and persists the moment its association
 * succeeds; Save Progress/Continue only record the step's status (they
 * re-send the session's own current `resumeDocument` value unchanged).
 */
export function useResumeForm() {
  const { session, saveStep } = useSession();

  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const resume = (session?.formData?.[FORM_DATA_KEY] as UploadedFile | null | undefined) ?? null;
  const slot = useDocumentSlot(RESUME_SLOT.docType, resume, RESUME_REQUIREMENT);
  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateResume(resume), [resume]);
  const shownErrors = touched ? errors : {};

  async function save(status: 'in_progress' | 'completed' | undefined): Promise<SubmitOutcome> {
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: resume, stepId: STEP_ID, status });
    if (result.status === 'saved') return { kind: 'saved' };
    if (result.status === 'conflict') return { kind: 'conflict' };
    if (isStepValidationRejection(result.error) && Object.keys(errors).length > 0) {
      setTouched(true);
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const outcome = await save(isCompleted ? undefined : 'in_progress');
    setIsSaving(false);
    return outcome;
  }

  /** Never completes until the resume is authoritatively associated with
   * the session — a picked-but-not-uploaded file never counts. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(true);
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };
    setIsCompleting(true);
    setSaveError(null);
    const outcome = await save('completed');
    setIsCompleting(false);
    return outcome;
  }

  return {
    slot,
    resume,
    errors: shownErrors,
    isSaving,
    isCompleting,
    saveError,
    isCompleted,
    saveProgress,
    complete,
  };
}
