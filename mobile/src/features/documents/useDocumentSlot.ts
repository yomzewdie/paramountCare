import { useRef, useState } from 'react';
import { MAX_ATTACHMENTS_PER_DOCUMENT, allowsMultipleAttachments, documentAttachmentsFor, type UploadedFile } from '@pcs/shared';
import { useSession } from '../onboarding/SessionContext';
import { useDocumentCapture, discardCapturedFile, type PendingCapture } from './useDocumentCapture';
import { deleteUpload, uploadFile } from '../onboarding/uploadApi';
import type { AssociateDocumentOptions } from '../onboarding/sessionApi';
import type { DocumentRequirement } from './documentRequirements';

export type DocumentSlotStatus = 'idle' | 'uploading' | 'associating' | 'uploaded' | 'failed';

interface QueuedUpload {
  capture: PendingCapture;
  /** Set once uploaded, so a failed association retries without re-uploading. */
  uploaded: UploadedFile | null;
  options: AssociateDocumentOptions | undefined;
}

/**
 * One document requirement's full lifecycle, used by every upload in the app —
 * capture/select, upload, ownership-verified session association, and managing
 * its attachments (add more, replace one, remove one). A requirement holds one
 * or more attachments; several files picked at once upload one after another.
 *
 * The attachments themselves are read straight from the live session rather
 * than duplicated into local state. That is possible specifically because a
 * document has no "unsaved draft" the way a text field does — a file is either
 * fully, authoritatively associated or it isn't — so there is nothing to
 * preserve across a conflict beyond what the fresh session already shows. A
 * stale revision is therefore simply retried against that fresh session.
 *
 * `currentFile` is the requirement's first attachment, as the caller reads it.
 */
export function useDocumentSlot(
  docType: string,
  currentFile: UploadedFile | null,
  requirement: DocumentRequirement,
) {
  const { session, associateDocument, removeDocument } = useSession();

  const [phase, setPhase] = useState<'idle' | 'uploading' | 'associating' | 'failed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  // The attachment being replaced, and whether Upload More is showing the
  // capture actions — both only ever while the applicant is choosing a file.
  const [replacing, setReplacing] = useState<UploadedFile | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  const queue = useRef<QueuedUpload[]>([]);

  const capture = useDocumentCapture(requirement);

  const stored = documentAttachmentsFor(session?.formData, docType);
  const attachments = stored.length > 0 ? stored : currentFile ? [currentFile] : [];
  const allowsMultiple = allowsMultipleAttachments(docType);
  const canAddMore = allowsMultiple && attachments.length < MAX_ATTACHMENTS_PER_DOCUMENT;

  /** Works through the queue in order. Never reports success until each file's
   * ownership-verified association itself succeeds, and a failure stops here
   * with everything already saved left in place and the rest still queued, so
   * Retry continues from exactly this file. */
  async function drain(total: number): Promise<void> {
    setErrorMessage(null);
    while (queue.current.length > 0) {
      const item = queue.current[0];
      setProgress({ current: total - queue.current.length + 1, total });

      if (!item.uploaded) {
        setPhase('uploading');
        const result = await uploadFile(item.capture.picked);
        if (!result.ok) {
          setErrorMessage(result.error.message);
          setPhase('failed');
          return;
        }
        item.uploaded = result.data;
        void discardCapturedFile(item.capture);
      }

      setPhase('associating');
      const objectKey = item.uploaded.objectKey!;
      const associate = () => (item.options ? associateDocument(docType, objectKey, item.options) : associateDocument(docType, objectKey));
      let saved = await associate();
      // A conflict means the session moved on: the context now holds the fresh
      // revision, and neither adding nor replacing depends on what changed.
      if (saved.status === 'conflict') saved = await associate();
      if (saved.status !== 'saved') {
        setErrorMessage(saved.status === 'error' ? saved.error.message : 'That didn’t save. Please try again.');
        setPhase('failed');
        return;
      }
      queue.current.shift();
    }
    setPhase('idle');
    setProgress(null);
  }

  function associateOptions(): AssociateDocumentOptions | undefined {
    if (!allowsMultiple) return undefined;
    return replacing?.objectKey ? { replaceObjectKey: replacing.objectKey } : { mode: 'add' };
  }

  function confirmUse(): void {
    void capture.confirmUse(async (items) => {
      const options = associateOptions();
      queue.current = items.map((item) => ({ capture: item, uploaded: null, options }));
      setReplacing(null);
      setAddingMore(false);
      await drain(items.length);
    });
  }

  function retry(): void {
    if (phase === 'failed' && queue.current.length > 0) void drain(progress?.total ?? queue.current.length);
  }

  /** Gives up on whatever failed to finish. Only now is an uploaded-but-never-
   * associated object an orphan — best-effort deleted — since until this point
   * Retry could still have attached it. */
  function cancelFailed(): void {
    for (const item of queue.current) {
      if (item.uploaded?.objectKey) void deleteUpload(item.uploaded.objectKey);
      else void discardCapturedFile(item.capture);
    }
    queue.current = [];
    setPhase('idle');
    setProgress(null);
    setErrorMessage(null);
  }

  async function removeFromSession(objectKey?: string): Promise<void> {
    setErrorMessage(null);
    const result = await (objectKey ? removeDocument(docType, objectKey) : removeDocument(docType));
    if (result.status === 'error') setErrorMessage(result.error.message);
  }

  /** Clears the whole requirement. The session's own reference goes FIRST
   * (server-enforced ordering — see routes/sessions.ts), then the underlying
   * objects are deleted; a temporarily orphaned object is preferable to the
   * session ever referencing a deleted one (M13 hardening §5). */
  function remove(): void {
    cancelFailed();
    void removeFromSession();
  }

  /** Removes one attachment and leaves the others. */
  function removeAttachment(file: UploadedFile): void {
    if (attachments.length <= 1 || !file.objectKey) {
      remove();
      return;
    }
    void removeFromSession(file.objectKey);
  }

  const status: DocumentSlotStatus = phase !== 'idle' ? phase : attachments.length > 0 ? 'uploaded' : 'idle';

  return {
    docType,
    status,
    /** The first attachment. */
    file: attachments[0] ?? null,
    attachments,
    requirement,
    allowsMultiple,
    canAddMore,
    /** Which file of a multi-file upload is in progress. */
    progress,
    errorMessage,
    replacing,
    addingMore,
    startReplace: (file: UploadedFile) => { setAddingMore(false); setReplacing(file); },
    startAddingMore: () => { setReplacing(null); setAddingMore(true); },
    cancelChoosing: () => { setReplacing(null); setAddingMore(false); },
    capture: {
      pending: capture.pending,
      pendingItems: capture.pendingItems,
      permissionError: capture.permissionError,
      scan: capture.scan,
      takePhoto: capture.takePhoto,
      // Several photos at once, unless this requirement is one file or one
      // attachment is being replaced.
      pickFromLibrary: () => capture.pickFromLibrary({
        selectionLimit: allowsMultiple && !replacing ? MAX_ATTACHMENTS_PER_DOCUMENT - attachments.length : 1,
      }),
      pickDocument: capture.pickDocument,
      retake: capture.retake,
      removePending: capture.removePending,
      confirmUse,
    },
    retry,
    cancelFailed,
    remove,
    removeAttachment,
  };
}
