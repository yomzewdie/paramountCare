import { useMemo, useState } from 'react';
import { getPacket, validateVaccineDeclination, type AcknowledgementEntry, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';
import { isStepValidationRejection } from './serverValidationError';

const FORM_DATA_KEY = 'acknowledgements';

const EMPTY_ENTRY: AcknowledgementEntry = { checked: false, typedSignature: '', signedAt: '', decision: null };

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
  const [touched, setTouched] = useState<Partial<Record<keyof AcknowledgementEntry, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: AcknowledgementEntry } | null>(null);

  const isCompleted = session?.stepStates[stepId] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateVaccineDeclination(data, requiresSignature), [data, requiresSignature]);
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

  function blurField(field: keyof AcknowledgementEntry): void {
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
      setTouched(touchAll(EMPTY_ENTRY));
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
   * matches `validateVaccineDeclination()` exactly, including that
   * choosing "providing_proof" requires nothing further at this step (no
   * upload is required here — see ADR-025). */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(EMPTY_ENTRY));
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
    saveProgress,
    complete,
    keepMyChanges,
    discardAndReloadLatest,
  };
}
