import { useMemo, useState } from 'react';
import { defaultFormData, getPacket, validateDocuments, type FieldErrors, type UploadedDocuments } from '@pcs/shared';
import { useSession } from './SessionContext';
import { useDocumentSlot } from '../documents/useDocumentSlot';
import { PARAMOUNT_IDENTITY_SLOTS } from '../documents/documentSlots';
import { IDENTITY_DOCUMENT_REQUIREMENT } from '../documents/documentRequirements';
import { isStepValidationRejection } from './serverValidationError';
import type { SubmitOutcome } from './useDocumentsForm';

const STEP_ID = 'identity_documents';
const FORM_DATA_KEY = 'uploadedDocuments';

/**
 * Paramount Care's Identity Documents step: the applicant's Driver's License
 * and Social Security Card — the company's own onboarding requirement, kept
 * separate from the federal Form I-9 document selection that follows in
 * Documents & Credentials. Each document uses the same upload lifecycle as
 * every other (useDocumentSlot: scan, photo, photo library, file; add more,
 * replace, remove), persisting itself the moment it succeeds; this hook's own
 * Save Progress / Continue only ever set the step's status, exactly like the
 * Documents step (the Worker ignores client-sent document data anyway).
 */
export function useIdentityDocumentsForm() {
  const { session, saveStep } = useSession();
  const step = session ? getPacket(session.packetId)?.steps.find((s) => s.id === STEP_ID) : undefined;
  const stored = session?.formData?.[FORM_DATA_KEY];
  const documents = useMemo<UploadedDocuments>(
    () => ({ ...defaultFormData.uploadedDocuments, ...((stored ?? {}) as Partial<UploadedDocuments>) }),
    [stored],
  );

  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const driversLicense = useDocumentSlot('drivers_license', documents.driversLicense ?? null, IDENTITY_DOCUMENT_REQUIREMENT);
  const socialSecurityCard = useDocumentSlot('social_security_card', documents.socialSecurityCard ?? null, IDENTITY_DOCUMENT_REQUIREMENT);
  const slotHooks: Record<string, ReturnType<typeof useDocumentSlot>> = { drivers_license: driversLicense, social_security_card: socialSecurityCard };

  const errors = useMemo<FieldErrors>(() => validateDocuments(documents, step), [documents, step]);
  const uploadedCount = PARAMOUNT_IDENTITY_SLOTS.filter((slot) => !!documents[slot.formDataField]).length;
  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  async function save(status: 'in_progress' | 'completed' | undefined): Promise<SubmitOutcome> {
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: documents, stepId: STEP_ID, status });
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
    const outcome = await save(isCompleted ? undefined : 'in_progress');
    setIsSaving(false);
    return outcome;
  }

  /** Blocks until both documents are genuinely uploaded and associated. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(true);
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };
    setIsCompleting(true);
    const outcome = await save('completed');
    setIsCompleting(false);
    return outcome;
  }

  return {
    slots: PARAMOUNT_IDENTITY_SLOTS,
    slotHooks,
    documents,
    uploadedCount,
    totalCount: PARAMOUNT_IDENTITY_SLOTS.length,
    errors: touched ? errors : {},
    isSaving,
    isCompleting,
    saveError,
    isCompleted,
    saveProgress,
    complete,
  };
}
