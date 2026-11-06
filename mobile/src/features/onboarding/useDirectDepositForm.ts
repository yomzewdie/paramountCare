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
import { isStepValidationRejection } from './serverValidationError';
import { useDocumentSlot } from '../documents/useDocumentSlot';
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

/** A new primary deposit defaults to 100% (UAT feedback). Only applied while
 * nothing has been saved for the allocation — a saved type or amount is never
 * overwritten. The optional second account never gets a default: that would
 * mark it as started, and split the paycheck into more than 100%. */
function withDefaultAllocation(account: DirectDepositBankAccount): DirectDepositBankAccount {
  if (account.depositType || account.depositAmount.trim()) return account;
  return { ...account, depositType: 'percentage', depositAmount: '100' };
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
    primaryAccount: withDefaultAllocation(mergeAccount(defaultDirectDepositData.primaryAccount, stored.primaryAccount)),
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

/**
 * Form-state + save/conflict logic for the Direct Deposit Authorization
 * step (ICU RN / ER RN / Travel RN only). Source: Paramount's "Business
 * Payroll Services — Direct Deposit Authorization" form (see
 * packages/shared/src/onboarding.ts's DirectDepositData doc comment) —
 * every field, the routing-number rule, the dual-account support, and the
 * required voided-check proof come directly from that source, not
 * invented. See ADR-025/ADR-026.
 *
 * The bank-verification attachments use the same lifecycle as every other
 * document (useDocumentSlot): upload, then ownership-verified association with
 * this session. Both are independent of the surrounding form fields' own Save
 * Progress, so an associated attachment survives an app restart even if the
 * applicant never taps Save Progress, and the file itself is always read
 * straight from the live session.
 */
export function useDirectDepositForm() {
  const { session, saveStep } = useSession();

  const [data, setData] = useState<DirectDepositData>(() => readStoredData(session?.formData));
  const [touched, setTouched] = useState<Partial<Record<TouchKey, boolean>>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latestData: DirectDepositData } | null>(null);

  // The authoritative, server-confirmed proof document — present ONLY once a
  // real association succeeded, never merely because a file was picked or
  // finished uploading. This is what validation/completion check.
  const proof = readStoredProof(session?.formData);
  const proofSlot = useDocumentSlot(DOC_TYPE, proof, VOIDED_CHECK_REQUIREMENT);

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  // Declared here (before handleResult, which reads it) rather than lower
  // down near the other field-derived values — React Compiler's
  // memoization analysis can't preserve a useMemo that a same-scope
  // function defined ABOVE it closes over, even though the forward
  // reference is perfectly valid JS (handleResult is only ever invoked
  // later, after this line has already run).
  const errors = useMemo<FieldErrors>(() => validateDirectDeposit(data, proof), [data, proof]);

  function handleResult(result: SaveStepResult): SubmitOutcome {
    if (result.status === 'saved') {
      setIsDirty(false);
      return { kind: 'saved' };
    }
    if (result.status === 'conflict') {
      setConflict({ latestData: readStoredData(result.latestSession.formData) });
      return { kind: 'conflict' };
    }
    if (isStepValidationRejection(result.error) && Object.keys(errors).length > 0) {
      setTouched(touchAll(ALL_FIELDS_TOUCH_SHAPE));
      return { kind: 'invalid' };
    }
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

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
    proofSlot,
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
