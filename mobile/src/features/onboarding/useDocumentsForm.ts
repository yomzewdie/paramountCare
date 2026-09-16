import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPacket,
  validateDocuments,
  defaultFormData,
  type UploadedDocuments,
  type FieldErrors,
} from '@pcs/shared';
import { useSession } from './SessionContext';
import { useDocumentSlot } from '../documents/useDocumentSlot';
import {
  IDENTITY_SLOTS,
  CREDENTIAL_SLOT_BY_KEY,
  resolveRequiredSlots,
  isIdentityGroupSatisfied,
  deriveCurrentIdentityPath,
  type DocumentSlotDef,
  type IdentityPath,
} from '../documents/documentSlots';
import { IDENTITY_DOCUMENT_REQUIREMENT, CREDENTIAL_DOCUMENT_REQUIREMENT } from '../documents/documentRequirements';

const STEP_ID = 'documents';
const FORM_DATA_KEY = 'uploadedDocuments';

export type SubmitOutcome =
  | { kind: 'saved' }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string };

function readStoredDocuments(formData: Record<string, unknown> | undefined): UploadedDocuments {
  const stored = (formData?.[FORM_DATA_KEY] ?? {}) as Partial<UploadedDocuments>;
  return { ...defaultFormData.uploadedDocuments, ...stored };
}

/**
 * Orchestrates the `documents` step's full checklist — a fixed set of
 * per-slot lifecycles (`useDocumentSlot`, one call per possible slot,
 * always called in the same order regardless of which are actually
 * required for this packet — the Rules of Hooks require a stable call
 * count/order, and the actual set of *possible* slots is small and known
 * ahead of time even though which ones are *required* is packet-driven)
 * plus the step-level save/complete lifecycle every other step already
 * has. Each slot manages its own upload/association/replace/remove
 * independently and persists itself the moment it succeeds — this hook's
 * own `saveProgress`/`complete` only ever touch `stepStates`, matching the
 * exact pattern Direct Deposit's voided check already established (M13):
 * an attachment's own data is never part of what Save Progress/Complete
 * writes, only whether the step counts as `in_progress`/`completed`.
 *
 * M14 hardening: List A vs. List B+List C is an ALTERNATIVE-group
 * requirement, not three independent slots — the applicant explicitly
 * chooses one path (`identityPath`/`setIdentityPath`), and only that
 * path's card(s) are shown. Switching paths never deletes the currently
 * valid path's document(s) before the new path is fully, authoritatively
 * satisfied: the cleanup effect below only fires once the NEW path is
 * confirmed complete, exactly mirroring the safe replace ordering
 * `useDocumentSlot`/M13 already use for a single slot's own Replace
 * action, applied here across the two slots of an alternative group
 * instead of within one slot.
 */
export function useDocumentsForm() {
  const { session, saveStep } = useSession();

  const step = session ? getPacket(session.packetId)?.steps.find((s) => s.id === STEP_ID) : undefined;
  const requiredSlots = useMemo(() => resolveRequiredSlots(step), [step]);
  const requiredDocTypes = useMemo(() => new Set(requiredSlots.map((s) => s.docType)), [requiredSlots]);
  const identityRequired = requiredDocTypes.has('list_a');

  const documents = readStoredDocuments(session?.formData);

  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Which of the two alternative identity paths the applicant is currently
  // working with — initialized from whatever the session already shows
  // (an app restart resumes on the path that's actually valid, never
  // forcing a re-choice), and otherwise left for the applicant to pick
  // explicitly rather than showing all three cards at once with no stated
  // relationship between them.
  const [identityPath, setIdentityPathState] = useState<IdentityPath | null>(() => deriveCurrentIdentityPath(documents));

  function setIdentityPath(path: IdentityPath): void {
    setIdentityPathState(path);
  }

  const isCompleted = session?.stepStates[STEP_ID] === 'completed';

  const errors = useMemo<FieldErrors>(() => validateDocuments(documents, step), [documents, step]);

  // M14 hardening: `errors.i9` (shared, server-authoritative) only ever
  // asks "does SOME path satisfy the requirement" — by design, since that
  // is the real business rule and the one `packages/shared` correctly
  // enforces for packet-aware completion regardless of what a mobile
  // screen session happens to be doing. It deliberately does NOT know
  // about `identityPath` — ephemeral, screen-local intent has no business
  // living in server-authoritative validation.
  //
  // But that same shared rule creates a real gap for THIS screen
  // specifically: while a safe switch is in progress, the previously-valid
  // path is intentionally still present (never deleted early — see the
  // cleanup effect below) — so `errors.i9` reports "satisfied" via the OLD
  // path even though the applicant explicitly chose, and hasn't finished,
  // the NEW one. Left unchecked, Continue would silently complete the step
  // via a path the applicant believes they moved away from, while their
  // actual in-progress upload (e.g. a lone List B) sits abandoned.
  // `identityPathError` is the small, local, non-persisted screen-level
  // gate that closes that gap: it enforces "the path you currently have
  // SELECTED must itself be complete," on top of (never instead of) the
  // shared rule. It never blocks Save Progress, never affects
  // `stepStates`/`documentsCompletion()`, and disappears entirely once the
  // applicant isn't actively mid-switch (their selected path already
  // matches what's authoritatively stored).
  const identityPathError = useMemo<string | null>(() => {
    if (!identityRequired || !identityPath) return null;
    if (identityPath === 'list_a') {
      return documents.listA ? null : 'Upload your List A document to continue with this option.';
    }
    if (documents.listB && documents.listC) return null;
    if (!documents.listB && !documents.listC) return 'Upload a List B document and a List C document to continue with this option.';
    if (!documents.listB) return 'Upload a List B document to continue with this option.';
    return 'Upload a List C document to continue with this option.';
  }, [identityRequired, identityPath, documents.listA, documents.listB, documents.listC]);

  const shownErrors = touched ? errors : {};
  const shownIdentityPathError = touched ? identityPathError : null;

  // One useDocumentSlot call per POSSIBLE slot — always called, never
  // conditionally, so hook call order stays stable across renders
  // regardless of which slots this packet actually requires (see doc
  // comment above). Rendering/requiredness is decided separately, by
  // `requiredDocTypes`/`resolveRequiredSlots`, not by which of these calls
  // happened to run.
  const listA = useDocumentSlot('list_a', documents.listA, IDENTITY_DOCUMENT_REQUIREMENT);
  const listB = useDocumentSlot('list_b', documents.listB, IDENTITY_DOCUMENT_REQUIREMENT);
  const listC = useDocumentSlot('list_c', documents.listC, IDENTITY_DOCUMENT_REQUIREMENT);
  const nursingLicense = useDocumentSlot('nursing_license', documents.nursingLicense, CREDENTIAL_DOCUMENT_REQUIREMENT);
  const cprCertification = useDocumentSlot('cpr_cert', documents.cprCertification, CREDENTIAL_DOCUMENT_REQUIREMENT);

  const slotHooks: Record<string, ReturnType<typeof useDocumentSlot>> = {
    list_a: listA,
    list_b: listB,
    list_c: listC,
    nursing_license: nursingLicense,
    cpr_cert: cprCertification,
  };

  /** Only the slots this applicant's own packet actually requires (§9/§21
   * of the M14 prompt) — a slot not returned here is never shown, never
   * required, and never counted, no matter what `slotHooks` contains. */
  const visibleIdentitySlots: DocumentSlotDef[] = IDENTITY_SLOTS.filter((s) => requiredDocTypes.has(s.docType));
  const visibleCredentialSlots: DocumentSlotDef[] = Object.values(CREDENTIAL_SLOT_BY_KEY).filter((s) => requiredDocTypes.has(s.docType));

  const identitySatisfied = isIdentityGroupSatisfied(documents);

  // Data minimization: once the applicant's NEWLY chosen identity path is
  // fully, authoritatively satisfied, the now-unnecessary OTHER path's
  // document(s) are removed via each slot's own safe `remove()` (session
  // reference cleared first, then the R2 object — the same M13 ordering
  // every other Replace/Remove already uses). This never fires before the
  // new path is complete, so a currently-valid path is never destroyed
  // mid-switch, a partial switch (e.g. List B uploaded, List C still
  // missing) leaves the old path fully intact, and a stale-revision/network
  // failure on the association simply never satisfies the "new path
  // complete" condition — nothing to clean up, nothing lost either way.
  // Guarded by objectKey so a given file is only ever asked to be removed
  // once, not on every re-render while the condition continues to hold.
  const cleanedUpKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!identityRequired) return;

    // Keyed by "docType:objectKey", not objectKey alone — two different
    // slots must never be able to suppress each other's cleanup merely
    // because they happen to reference the same key (which real uploads
    // never do — each gets a fresh UUID-based key — but the guard is
    // written to hold regardless of that, not to rely on it).
    function removeOnce(docType: string, objectKey: string | undefined, slot: typeof listA): void {
      if (!objectKey) return;
      const guardKey = `${docType}:${objectKey}`;
      if (cleanedUpKeys.current.has(guardKey)) return;
      cleanedUpKeys.current.add(guardKey);
      slot.remove();
    }

    if (identityPath === 'list_b_c' && documents.listB && documents.listC && documents.listA) {
      removeOnce('list_a', documents.listA.objectKey, listA);
    } else if (identityPath === 'list_a' && documents.listA) {
      if (documents.listB) removeOnce('list_b', documents.listB.objectKey, listB);
      if (documents.listC) removeOnce('list_c', documents.listC.objectKey, listC);
    }
    // listA/listB/listC are fresh objects every render (useDocumentSlot
    // returns a new object each time) — depending on the actual document
    // values (which only change when the session does) instead avoids
    // re-running this effect on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityRequired, identityPath, documents.listA, documents.listB, documents.listC]);

  async function saveProgress(): Promise<SubmitOutcome> {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveStep({
      formDataKey: FORM_DATA_KEY,
      stepData: documents,
      stepId: STEP_ID,
      status: isCompleted ? undefined : 'in_progress',
    });
    setIsSaving(false);
    if (result.status === 'saved') return { kind: 'saved' };
    if (result.status === 'conflict') return { kind: 'conflict' };
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  /** Reveals every missing-required-document error and blocks completion
   * until each one is genuinely, authoritatively uploaded — never merely
   * locally selected (structurally guaranteed: `documents.*` fields only
   * ever come from the session, which only ever gets them via the
   * ownership-verified association endpoint). Also blocks on
   * `identityPathError` — the applicant's own explicitly SELECTED identity
   * path, not merely whichever path a retained-for-safety old document
   * happens to still satisfy (see that value's own doc comment above). */
  async function complete(): Promise<SubmitOutcome> {
    setTouched(true);
    if (Object.keys(errors).length > 0 || identityPathError) return { kind: 'invalid' };

    setIsCompleting(true);
    setSaveError(null);
    const result = await saveStep({ formDataKey: FORM_DATA_KEY, stepData: documents, stepId: STEP_ID, status: 'completed' });
    setIsCompleting(false);
    if (result.status === 'saved') return { kind: 'saved' };
    if (result.status === 'conflict') return { kind: 'conflict' };
    setSaveError(result.error.message);
    return { kind: 'error', message: result.error.message };
  }

  return {
    identityRequired,
    identityPath,
    setIdentityPath,
    visibleIdentitySlots,
    visibleCredentialSlots,
    identitySatisfied,
    identityPathError: shownIdentityPathError,
    slotHooks,
    errors: shownErrors,
    isSaving,
    isCompleting,
    saveError,
    isCompleted,
    saveProgress,
    complete,
  };
}
