import { useMemo, useState } from 'react';
import {
  defaultDirectDepositData,
  validateDirectDeposit,
  type DirectDepositData,
  type DirectDepositBankAccount,
  type PersonalInfo,
  type UploadedFile,
  type FieldErrors,
} from '@pcs/shared';
import { useSession } from './SessionContext';
import type { SaveStepResult } from './SessionContext';
import { visibleErrors as revealTouched, touchAll } from './formTouch';
import { useFileAttachment, type AttachmentStatus } from './useFileAttachment';
import { deleteUpload } from './uploadApi';
import { useDocumentCapture } from '../documents/useDocumentCapture';
import { VOIDED_CHECK_REQUIREMENT } from '../documents/documentRequirements';

const STEP_ID = 'direct_deposit';
const FORM_DATA_KEY = 'directDepositData';
const PROOF_DATA_KEY = 'directDepositProofDocument';
const DOC_TYPE = 'direct_deposit_voided_check';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

// Every field key validateDirectDeposit()/validateBankAccount() can put in
// its FieldErrors — flat, not keyof DirectDepositData, since the two bank
// accounts are nested objects. Used only to drive touchAll()/blurField()'s
// "which fields has the applicant interacted with" bookkeeping.
const ALL_FIELDS_TOUCH_SHAPE = {
  lastName: true, firstName: true,
  primaryBankName: true, primaryAccountType: true, primaryRoutingNumber: true,
  primaryAccountNumber: true, primaryDepositType: true, primaryDepositAmount: true,
  additionalBankName: true, additionalAccountType: true, additionalRoutingNumber: true,
  additionalAccountNumber: true, additionalDepositType: true, additionalDepositAmount: true,
  typedSignature: true, signedDate: true,
  directDepositProofDocument: true,
};
type TouchKey = keyof typeof ALL_FIELDS_TOUCH_SHAPE;

function formatSignedDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function mergeAccount(base: DirectDepositBankAccount, stored: Partial<DirectDepositBankAccount> | undefined): DirectDepositBankAccount {
  return { ...base, ...(stored ?? {}) };
}

/** Prefills the employee name from Personal Information exactly once, the
 * same "only if this step's own copy is still completely empty" rule
 * useW4Form.ts uses — Direct Deposit keeps its own independent copy of the
 * name (matching the source form's own "2. Employee Information" section),
 * not a live reference to PersonalInfo. */
function readStoredData(formData: Record<string, unknown> | undefined): DirectDepositData {
  const stored = (formData?.[FORM_DATA_KEY] ?? {}) as Partial<DirectDepositData>;
  const base: DirectDepositData = {
    ...defaultDirectDepositData,
    ...stored,
    primaryAccount: mergeAccount(defaultDirectDepositData.primaryAccount, stored.primaryAccount),
    additionalAccount: mergeAccount(defaultDirectDepositData.additionalAccount, stored.additionalAccount),
  };
  if (base.lastName || base.firstName) return base;

  const personalInfo = (formData?.personalInfo ?? {}) as Partial<PersonalInfo>;
  return {
    ...base,
    lastName: personalInfo.lastName ?? '',
    firstName: personalInfo.firstName ?? '',
    middleInitial: personalInfo.middleInitial ?? '',
  };
}

function readStoredProof(formData: Record<string, unknown> | undefined): UploadedFile | null {
  return (formData?.[PROOF_DATA_KEY] as UploadedFile | null | undefined) ?? null;
}

/** The status the screen actually shows — folds the raw upload lifecycle
 * (useFileAttachment) together with the separate association step, so
 * "uploaded" is never displayed until the session association itself has
 * actually succeeded (M13 hardening §22: never display success before
 * authoritative session association succeeds). */
export type ProofDisplayStatus = AttachmentStatus | 'associating';

/**
 * Form-state + save/conflict logic for the Direct Deposit Authorization
 * step (ICU RN / ER RN / Travel RN only). Source: Paramount's "Business
 * Payroll Services — Direct Deposit Authorization" form (see
 * packages/shared/src/onboarding.ts's DirectDepositData doc comment) —
 * every field, the routing-number rule, the dual-account support, and the
 * required voided-check proof come directly from that source, not
 * invented. See ADR-025/ADR-026.
 *
 * The voided-check attachment's lifecycle (M13 hardening) is a two-step
 * process, not one PATCH: upload (via useFileAttachment, owned by the
 * applicant the moment R2/the ownership ledger accept it) THEN an
 * ownership-verified association with this session
 * (SessionContext.associateDocument — a dedicated Worker endpoint, not the
 * generic session PATCH, since associating requires a server-side check
 * that this exact object was actually uploaded by this exact applicant).
 * Both steps are independent of the surrounding form fields' own Save
 * Progress, so a successfully associated attachment survives an app
 * restart even if the applicant never taps Save Progress. A failed
 * association leaves the object an orphan (uploaded, never attached to any
 * session) — best-effort cleaned up via the authenticated delete
 * capability, never treated as fatal to the rest of the form.
 */
export function useDirectDepositForm() {
  const { session, saveStep, associateDocument, removeDocument } = useSession();

  const [data, setData] = useState<DirectDepositData>(() => readStoredData(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<TouchKey, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latestData: DirectDepositData; latestProof: UploadedFile | null } | null>(null);

  // The authoritative, server-confirmed proof document — set ONLY once a
  // real association succeeds (or on initial load / conflict reload), never
  // merely because a file was picked or finished uploading. This is what
  // validation/completion check, not the raw upload state.
  const [associatedProof, setAssociatedProof] = useState<UploadedFile | null>(() => readStoredProof(session?.formData));
  const [associationPhase, setAssociationPhase] = useState<'idle' | 'associating' | 'failed'>('idle');
  const [associationError, setAssociationError] = useState<string | null>(null);
  // The most recently uploaded (not necessarily associated) file — kept so
  // a failed association can be retried without re-uploading.
  const [pendingUpload, setPendingUpload] = useState<UploadedFile | null>(null);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  function handleResult(result: SaveStepResult): SubmitOutcome {
    if (result.status === 'saved') {
      setIsDirty(false);
      return { kind: 'saved' };
    }
    if (result.status === 'conflict') {
      setConflict({
        latestData: readStoredData(result.latestSession.formData),
        latestProof: readStoredProof(result.latestSession.formData),
      });
      return { kind: 'conflict' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Associates a just-uploaded file with this session's voided-check slot.
   * Never reports the attachment as saved until this itself succeeds. On a
   * hard failure (not a conflict — a conflict is retryable with the same
   * object, so it is never treated as an orphan), the uploaded object is
   * now genuinely unassociated with anything; best-effort delete it via the
   * authenticated delete capability rather than leaving it behind for no
   * reason (M13 hardening §7). The existing, already-associated attachment
   * — if any — is left completely untouched throughout. */
  async function persistProof(file: UploadedFile): Promise<void> {
    setPendingUpload(file);
    setAssociationPhase('associating');
    setAssociationError(null);

    const result = await associateDocument(DOC_TYPE, file.objectKey!);

    if (result.status === 'saved') {
      setAssociatedProof(readStoredProof(result.session.formData));
      setAssociationPhase('idle');
      setPendingUpload(null);
      return;
    }
    if (result.status === 'conflict') {
      setConflict({
        latestData: readStoredData(result.latestSession.formData),
        latestProof: readStoredProof(result.latestSession.formData),
      });
      setAssociationPhase('idle');
      return;
    }
    setAssociationError(result.error.message);
    setAssociationPhase('failed');
    // Best-effort, fire-and-forget — a failure here is a documented
    // residual orphan-cleanup risk (M13 hardening §9), never something that
    // blocks or further alarms the applicant.
    if (file.objectKey) void deleteUpload(file.objectKey);
  }

  function retryAssociation(): void {
    if (pendingUpload) void persistProof(pendingUpload);
  }

  const rawAttachment = useFileAttachment(associatedProof, (file) => {
    void persistProof(file);
  });

  // The smart-capture layer (frame → capture → local quality check →
  // preview → Retake/Use Document) sits in FRONT of rawAttachment's own
  // upload lifecycle — "Use Document" is the only path that ever calls
  // uploadPicked, so nothing reaches the authenticated upload without a
  // confirmed, quality-checked capture first (M13 hardening §9/§20).
  // Configured via VOIDED_CHECK_REQUIREMENT — nothing Direct-Deposit-
  // specific lives inside useDocumentCapture itself.
  const capture = useDocumentCapture(VOIDED_CHECK_REQUIREMENT);

  function confirmUseDocument(): void {
    void capture.confirmUse((picked) => rawAttachment.uploadPicked(picked));
  }

  const proofStatus: ProofDisplayStatus =
    rawAttachment.status === 'uploading' ? 'uploading'
    : rawAttachment.status === 'failed' ? 'failed'
    : associationPhase === 'associating' ? 'associating'
    : associationPhase === 'failed' ? 'failed'
    : associatedProof ? 'uploaded' : 'idle';

  const proofErrorMessage = rawAttachment.errorMessage ?? associationError;

  function retryProof(): void {
    if (rawAttachment.status === 'failed') { rawAttachment.retry(); return; }
    if (associationPhase === 'failed') { retryAssociation(); return; }
  }

  /** Explicit applicant Remove — clears the session's own reference FIRST
   * (server-enforced ordering, see routes/sessions.ts), and only then is
   * the underlying object actually deleted; a temporarily orphaned object
   * is preferable to the session ever pointing at a deleted one (M13
   * hardening §5). Local UI state resets immediately so Remove always
   * feels instant regardless of the network round trip. */
  function removeProof(): void {
    rawAttachment.remove();
    setAssociationPhase('idle');
    setAssociationError(null);
    setPendingUpload(null);
    void (async () => {
      const result = await removeDocument(DOC_TYPE);
      if (result.status === 'saved') {
        setAssociatedProof(readStoredProof(result.session.formData));
        return;
      }
      if (result.status === 'conflict') {
        setConflict({
          latestData: readStoredData(result.latestSession.formData),
          latestProof: readStoredProof(result.latestSession.formData),
        });
        return;
      }
      setSaveError(result.error.message);
    })();
  }

  const errors = useMemo<FieldErrors>(() => validateDirectDeposit(data, associatedProof), [data, associatedProof]);
  const shownErrors = useMemo<FieldErrors>(() => revealTouched<TouchKey>(errors, touched), [errors, touched]);

  function setLastName(value: string): void { setData((d) => ({ ...d, lastName: value })); setIsDirty(true); }
  function setFirstName(value: string): void { setData((d) => ({ ...d, firstName: value })); setIsDirty(true); }
  function setMiddleInitial(value: string): void { setData((d) => ({ ...d, middleInitial: value })); setIsDirty(true); }
  function setEmployeeId(value: string): void { setData((d) => ({ ...d, employeeId: value })); setIsDirty(true); }

  function setPrimaryField<K extends keyof DirectDepositBankAccount>(field: K, value: DirectDepositBankAccount[K]): void {
    setData((d) => ({ ...d, primaryAccount: { ...d.primaryAccount, [field]: value } }));
    setIsDirty(true);
  }

  function setAdditionalField<K extends keyof DirectDepositBankAccount>(field: K, value: DirectDepositBankAccount[K]): void {
    setData((d) => ({ ...d, additionalAccount: { ...d.additionalAccount, [field]: value } }));
    setIsDirty(true);
  }

  /** Typing a signature also auto-stamps `signedDate` — same client-derived
   * timestamp limitation as W-4/I-9/vaccine declination (ADR-021). */
  function setTypedSignature(value: string): void {
    setData((d) => ({
      ...d,
      typedSignature: value,
      signedDate: value.trim() ? formatSignedDate(new Date()) : d.signedDate,
    }));
    setIsDirty(true);
  }

  function blurField(field: TouchKey): void {
    setTouched((t) => ({ ...t, [field]: true }));
  }

  /** Saves exactly what's currently entered, no validation gate — matches
   * every other step's partial-save semantics. Never downgrades an
   * already-'completed' step back to 'in_progress'. Does not touch the
   * proof document — that field saves/associates itself independently. */
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

  /** Reveals every error (including a missing or not-yet-associated
   * voided-check attachment) and blocks completion entirely until every
   * required field — and a genuinely associated attachment, not merely a
   * locally selected file — are present, per the source form's own
   * requirements (M13 hardening §23). */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(touchAll(ALL_FIELDS_TOUCH_SHAPE));
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
    setData(conflict.latestData);
    setAssociatedProof(conflict.latestProof);
    setAssociationPhase('idle');
    setAssociationError(null);
    setPendingUpload(null);
    setConflict(null);
    setIsDirty(false);
    setTouched({});
  }

  return {
    data,
    setLastName,
    setFirstName,
    setMiddleInitial,
    setEmployeeId,
    setPrimaryField,
    setAdditionalField,
    setTypedSignature,
    blurField,
    errors: shownErrors,
    attachment: {
      status: proofStatus,
      file: associatedProof,
      errorMessage: proofErrorMessage,
      retry: retryProof,
    },
    // The smart-capture layer — scan/takePhoto/pickFromLibrary/pickDocument
    // all lead to a `pending` preview (never a direct upload); the screen
    // renders that preview and calls confirmUseDocument()/capture.retake()
    // per the applicant's choice (M13 hardening §14).
    capture: {
      pending: capture.pending,
      permissionError: capture.permissionError,
      scan: capture.scan,
      takePhoto: capture.takePhoto,
      pickFromLibrary: capture.pickFromLibrary,
      pickDocument: capture.pickDocument,
      retake: capture.retake,
      confirmUse: confirmUseDocument,
    },
    removeProof,
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
