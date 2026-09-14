import { useMemo, useState } from 'react';
import { getPacket, validateAcknowledgement, type AcknowledgementEntry, type FieldErrors } from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';

const STEP_ID = 'application_statement';
const FORM_DATA_KEY = 'acknowledgements';

const EMPTY_ENTRY: AcknowledgementEntry = { checked: false, typedSignature: '', signedAt: '' };

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function readStored(formData: Record<string, unknown> | undefined): AcknowledgementEntry {
  const acks = (formData?.[FORM_DATA_KEY] ?? {}) as Record<string, Partial<AcknowledgementEntry> | undefined>;
  return { ...EMPTY_ENTRY, ...(acks[STEP_ID] ?? {}) };
}

/**
 * Form-state + save/conflict logic for Application Statement — the first
 * real signature/attestation step. This is NOT usePersonalInfoForm/
 * useEmploymentApplicationForm's shape reused: its data lives in the
 * shared `formData.acknowledgements` record (like employment references'
 * nested-record shape from M6), and it has exactly two fields with very
 * different interaction models (a checkbox that also stamps a timestamp,
 * and a typed-name signature), so it gets its own small hook rather than
 * being forced into either existing pattern. See ADR-021 for the full
 * signature-model reasoning; this hook implements exactly what
 * AcknowledgementSection.tsx (the existing web component) already does —
 * nothing invented.
 */
export function useApplicationStatementForm() {
  const { session, saveStep } = useSession();

  const step = session ? getPacket(session.packetId)?.steps.find((s) => s.id === STEP_ID) : undefined;
  const statementText = step?.config?.text ?? '';
  const requiresSignature = step?.config?.requiresSignature ?? false;

  const [data, setData] = useState<AcknowledgementEntry>(() => readStored(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<keyof AcknowledgementEntry, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: AcknowledgementEntry } | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateAcknowledgement(data, requiresSignature), [data, requiresSignature]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched(errors, touched), [errors, touched]);

  /** Toggling the acknowledgement checkbox also sets/clears `signedAt` —
   * exactly what the existing web AcknowledgementSection.tsx already does
   * (`signedAt: !data.checked ? new Date().toISOString() : ''`). This is a
   * client-derived timestamp, not server-generated (see ADR-021) —
   * preserved as-is, not "fixed," since fixing it isn't needed to
   * reproduce current functionality. */
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

  function blurSignature(): void {
    setTouched((t) => ({ ...t, typedSignature: true }));
  }

  /** Re-spreads the current session's full acknowledgements record so a
   * save here never wipes any OTHER acknowledgement step's already-saved
   * data — same reasoning as useEmploymentReferenceForm's mergedReferences. */
  function mergedAcknowledgements(next: AcknowledgementEntry): Record<string, unknown> {
    const existing = (session?.formData?.[FORM_DATA_KEY] ?? {}) as Record<string, unknown>;
    return { ...existing, [STEP_ID]: next };
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

  /** Saves exactly what's currently checked/typed, no validation gate —
   * matches every other step's partial-save semantics. There is no
   * existing product rule that treats an incomplete signature specially
   * on a plain save (the web app has no "can't save a partial signature"
   * restriction either — a save is just a save). Never downgrades an
   * already-'completed' step back to 'in_progress'. */
  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: mergedAcknowledgements(data),
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    return handleResult(result);
  }

  /** Reveals every error and blocks completion entirely if the checkbox
   * isn't checked or the signature is blank — a step is never marked
   * complete merely because the applicant opened the screen. Re-completing
   * an already-completed statement (e.g. re-signing after reviewing it
   * again) is permitted, matching the existing web app's own lack of any
   * completed-step immutability lock (confirmed by inspection — see
   * ADR-021). */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(EMPTY_ENTRY));
    if (Object.keys(errors).length > 0) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: mergedAcknowledgements(data), stepId: STEP_ID, status: 'completed' });
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
   * server's latest acknowledgement/signature. */
  function discardAndReloadLatest(): void {
    if (!conflict) return;
    setData(conflict.latest);
    setConflict(null);
    setIsDirty(false);
    setTouched({});
  }

  return {
    data,
    statementText,
    requiresSignature,
    toggleChecked,
    setTypedSignature,
    blurSignature,
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
