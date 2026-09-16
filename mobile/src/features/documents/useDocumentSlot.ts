import { useState } from 'react';
import type { UploadedFile } from '@pcs/shared';
import { useSession } from '../onboarding/SessionContext';
import { useFileAttachment, type AttachmentStatus } from '../onboarding/useFileAttachment';
import { useDocumentCapture } from './useDocumentCapture';
import { deleteUpload } from '../onboarding/uploadApi';
import type { DocumentRequirement } from './documentRequirements';

export type DocumentSlotStatus = AttachmentStatus | 'associating';

/**
 * One required document slot's full lifecycle — capture/select, upload,
 * ownership-verified session association, replace, remove — reusing every
 * M13 primitive unchanged (`useFileAttachment`, `useDocumentCapture`,
 * `SessionContext.associateDocument`/`removeDocument`). This is the
 * generalization of the pattern `useDirectDepositForm.ts` built ad hoc for
 * its single voided-check slot, extracted here because the Documents step
 * needs the identical lifecycle N times (List A, List B, List C, nursing
 * license, CPR/BLS cert) rather than once. `useDirectDepositForm.ts`
 * itself is intentionally left as-is — it already works and is already
 * tested; retrofitting it onto this hook is a reasonable future cleanup,
 * not something M14 does merely for symmetry (see ADR-027).
 *
 * Unlike Direct Deposit's own `associatedProof` local-state mirror, this
 * hook reads the slot's current file DIRECTLY from the live session
 * (`currentFile`, passed in by the caller from `session.formData
 * .uploadedDocuments[field]`) rather than duplicating it into local state.
 * That is possible here specifically because a document slot has no
 * "unsaved draft" the way a text field does — an upload is either fully,
 * authoritatively associated or it isn't, so there is nothing to preserve
 * across a conflict beyond what the fresh session already shows. A 409
 * here is therefore surfaced as a plain "that didn't save, try again"
 * error rather than Direct Deposit's Keep/Discard conflict banner — there
 * is no local edit that choice would ever need to protect.
 */
export function useDocumentSlot(
  docType: string,
  currentFile: UploadedFile | null,
  requirement: DocumentRequirement,
) {
  const { associateDocument, removeDocument } = useSession();

  const [phase, setPhase] = useState<'idle' | 'associating' | 'failed'>('idle');
  const [associationError, setAssociationError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<UploadedFile | null>(null);

  /** Never reports success until the ownership-verified association
   * itself succeeds (M13 hardening §22: never display success before
   * authoritative session association succeeds). A hard failure leaves a
   * genuine orphan (uploaded, never associated) — best-effort cleaned up
   * via the same authenticated delete capability every other M13 upload
   * uses; a conflict does not, since the object remains legitimately
   * re-associable on retry. */
  async function persist(file: UploadedFile): Promise<void> {
    setPendingUpload(file);
    setPhase('associating');
    setAssociationError(null);

    const result = await associateDocument(docType, file.objectKey!);

    if (result.status === 'saved') {
      setPhase('idle');
      setPendingUpload(null);
      return;
    }
    if (result.status === 'conflict') {
      // The session context already reflects the fresh authoritative
      // state; this slot's `currentFile` (read from it by the caller) will
      // simply show whatever that fresh state actually contains on the
      // next render — nothing to reconcile beyond that.
      setPhase('idle');
      setPendingUpload(null);
      return;
    }
    setAssociationError(result.error.message);
    setPhase('failed');
    if (file.objectKey) void deleteUpload(file.objectKey);
  }

  function retryAssociation(): void {
    if (pendingUpload) void persist(pendingUpload);
  }

  const rawAttachment = useFileAttachment(currentFile, (file) => {
    void persist(file);
  });

  const capture = useDocumentCapture(requirement);

  const status: DocumentSlotStatus =
    rawAttachment.status === 'uploading' ? 'uploading'
    : rawAttachment.status === 'failed' ? 'failed'
    : phase === 'associating' ? 'associating'
    : phase === 'failed' ? 'failed'
    : currentFile ? 'uploaded' : 'idle';

  const errorMessage = rawAttachment.errorMessage ?? associationError;

  function confirmUse(): void {
    void capture.confirmUse((picked) => rawAttachment.uploadPicked(picked));
  }

  function retry(): void {
    if (rawAttachment.status === 'failed') { rawAttachment.retry(); return; }
    if (phase === 'failed') { retryAssociation(); return; }
  }

  /** Clears the session's own reference FIRST (server-enforced ordering —
   * see routes/sessions.ts), then the underlying object is deleted; a
   * temporarily orphaned object is preferable to the session ever
   * referencing a deleted one (M13 hardening §5). */
  function remove(): void {
    rawAttachment.remove();
    setPhase('idle');
    setAssociationError(null);
    setPendingUpload(null);
    void (async () => {
      const result = await removeDocument(docType);
      if (result.status === 'error') setAssociationError(result.error.message);
    })();
  }

  return {
    docType,
    status,
    file: currentFile,
    errorMessage,
    capture: {
      pending: capture.pending,
      permissionError: capture.permissionError,
      scan: capture.scan,
      takePhoto: capture.takePhoto,
      pickFromLibrary: capture.pickFromLibrary,
      pickDocument: capture.pickDocument,
      retake: capture.retake,
      confirmUse,
    },
    retry,
    remove,
  };
}
