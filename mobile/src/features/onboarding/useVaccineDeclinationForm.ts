import { useMemo, useState } from 'react';
import { getPacket, validateVaccineDeclination, type AcknowledgementEntry, type FieldErrors, type UploadedFile } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';
import { isStepValidationRejection } from './serverValidationError';
import { useDocumentSlot } from '../documents/useDocumentSlot';
import { VACCINE_PROOF_SLOT_BY_TYPE } from '../documents/documentSlots';
import { VACCINATION_PROOF_REQUIREMENT } from '../documents/documentRequirements';

const FORM_DATA_KEY = 'acknowledgements';

const EMPTY_ENTRY: AcknowledgementEntry = { checked: false, typedSignature: '', signedAt: '', decision: null };

// `vaccineProofDocument` is not a field of AcknowledgementEntry (the proof
// lives in formData.vaccineProofDocuments[stepId], written only by the
// ownership-verified document-association route) but is a validation key,
// so it participates in touched-gating like any other field.
const TOUCH_SHAPE = { ...EMPTY_ENTRY, vaccineProofDocument: null };
type TouchKey = keyof typeof TOUCH_SHAPE;

function readStoredProof(formData: Record<string, unknown> | undefined, stepId: string): UploadedFile | null {
  const proofs = (formData?.vaccineProofDocuments ?? {}) as Record<string, UploadedFile | null | undefined>;
  return proofs[stepId] ?? null;
}

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function readStored(formData: Record<string, unknown> | undefined, stepId: string): AcknowledgementEntry {
  const acks = (formData?.[FORM_DATA_KEY] ?? {}) as Record<string, Partial<AcknowledgementEntry> | undefined>;
  return { ...EMPTY_ENTRY, ...(acks[stepId] ?? {}) };
}

/**
 * Form-state + save/conflict logic for a vaccine declination step
 * (hep_b/tdap/flu — all three share the exact same packet config shape:
 * `{acknowledgementId, requiresSignature: true, hasDeclination: true,
 * vaccineType, text}`, differing only in id/label/vaccineType/text). Built
 * stepId-generic from the start, the same way useEmploymentReferenceForm
 * and useAcknowledgementForm were, so wiring in tdap/flu later is a
 * registry entry, not new code — even though M13 only registers
 * hep_b_declination, per "earliest missing step only."
 *
 * NOT built on useAcknowledgementForm: `validateVaccineDeclination()` is a
 * genuinely different function with a real decision branch
 * ('declining' | 'providing_proof') neither useAcknowledgementForm's model
 * nor its screen has any equivalent of — forcing this in would be the
 * wrong abstraction, not a shortcut. See ADR-025.
 */
export function useVaccineDeclinationForm(stepId: string) {
  const { session, saveStep } = useSession();

  const step = session ? getPacket(session.packetId)?.steps.find((s) => s.id === stepId) : undefined;
  const heading = step?.label ?? '';
  const statementText = step?.config?.text ?? '';
  const vaccineType = step?.config?.vaccineType ?? '';
  const requiresSignature = step?.config?.requiresSignature ?? false;

  const [data, setData] = useState<AcknowledgementEntry>(() => readStored(session?.formData, stepId));
  const [touched, setTouched] = useState<Partial<Record<TouchKey, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: AcknowledgementEntry } | null>(null);

  const isCompleted = session?.stepStates[stepId] === 'completed';

  // The proof slot reuses the SAME secure upload lifecycle as every other
  // document (capture → upload → ownership-verified association). Its
  // current file is read straight from the live session, so it is always
  // whatever the server actually has. Called unconditionally (Rules of
  // Hooks); it is only RENDERED, and only REQUIRED, on the providing-proof
  // path.
  const proofSlotDef = VACCINE_PROOF_SLOT_BY_TYPE[vaccineType] ?? { docType: `${vaccineType}_vaccination_proof`, label: 'Vaccination proof' };
  const proofFile = readStoredProof(session?.formData, stepId);
  const proofSlot = useDocumentSlot(proofSlotDef.docType, proofFile, VACCINATION_PROOF_REQUIREMENT);

  const errors = useMemo<FieldErrors>(() => validateVaccineDeclination(data, requiresSignature, proofFile), [data, requiresSignature, proofFile]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  /** Choosing a decision — matches the existing web
   * VaccineDeclinationSection.tsx's `setDecision` exactly: switching to
   * "providing_proof" resets the acknowledgement/signature fields;
   * staying on or choosing "declining" preserves them. */
  function setDecision(decision: 'declining' | 'providing_proof'): void {
    setData((d) => ({
      ...d,
      decision,
      checked: decision === 'declining' ? d.checked : false,
      typedSignature: decision === 'declining' ? d.typedSignature : '',
      signedAt: decision === 'declining' ? d.signedAt : '',
    }));
    setIsDirty(true);
  }

  /** Toggling the declination-statement checkbox also sets/clears
   * `signedAt` — matches the existing web behavior (a client-derived
   * timestamp, same category of limitation as ADR-021's finding). */
  function toggleChecked(): void {
    setData((d) => ({
      ...d,
      checked: !d.checked,
      signedAt: !d.checked ? new Date().toISOString() : '',
    }));
    setIsDirty(true);
  }

  function setTypedSignature(value: string): void {
    setData((d) => ({ ...d, typedSignature: value }));
    setIsDirty(true);
  }

  function blurField(field: TouchKey): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  /** Re-spreads the current session's full acknowledgements record so a
   * save here never wipes any OTHER acknowledgement step's already-saved
   * data — same reasoning as useAcknowledgementForm's mergedAcknowledgements. */
  function mergedAcknowledgements(next: AcknowledgementEntry): Record<string, unknown> {
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
    if (isStepValidationRejection(result.error) && Object.keys(errors).length > 0) {
      setTouched(touchAll(TOUCH_SHAPE));
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Saves exactly what's currently selected/typed, no validation gate —
   * matches every other step's partial-save semantics. Never downgrades
   * an already-'completed' step back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: mergedAcknowledgements(data),
      stepId,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every error and blocks completion if no decision was made,
   * or (for the declining path only) the checkbox/signature are missing —
   * matches `validateVaccineDeclination()` exactly: "providing_proof"
   * REQUIRES the uploaded evidence (and nothing else); a declination
   * requires the checkbox + signature and never a document. */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(TOUCH_SHAPE));
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: mergedAcknowledgements(data), stepId, status: 'completed' });
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
    setTouched({});
  }

  return {
    data,
    heading,
    statementText,
    vaccineType,
    requiresSignature,
    setDecision,
    toggleChecked,
    setTypedSignature,
    blurField,
    errors: shownErrors,
    isDirty,
    isSaving,
    isCompleting,
    saveError,
    conflict,
    isCompleted,
    proofSlot,
    proofSlotDef,
    saveProgress,
    complete,
    keepMyChanges,
    discardAndReloadLatest,
  };
}
