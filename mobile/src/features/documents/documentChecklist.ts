import { documentAttachmentsFor, type UploadedDocuments, type UploadedFile } from '@pcs/shared';
import type { DocumentSlotDef, IdentityPath } from './documentSlots';

// The Documents & Credentials step as a guided checklist: the same required
// slots, rules and validation as before (documentSlots.ts / useDocumentsForm),
// presented as an ordered sequence with ONE active upload at a time.
//
// Order: the I-9 identity choice first, then the selected path's upload(s)
// (List A; or List B then List C), then the packet's credentials in the
// packet's own `requiredUploads` order, then any optional documents. Progress
// counts requirements the way the step always has: identity is ONE requirement
// (satisfied by the selected path), plus one per required credential. A
// requirement is one row however many attachments it holds.

export interface ChecklistItem {
  docType: string;
  slot: DocumentSlotDef;
  /** The requirement's first attachment. */
  file: UploadedFile | null;
  attachments: UploadedFile[];
  done: boolean;
  group: 'identity' | 'credential';
  optional: boolean;
}

export interface DocumentChecklist {
  identityRequired: boolean;
  /** Identity is required but no path is chosen yet — the choice is the active step. */
  needsIdentityChoice: boolean;
  items: ChecklistItem[];
  /** The first incomplete REQUIRED upload, in order — the one shown expanded. */
  activeDocType: string | null;
  completedRequired: number;
  totalRequired: number;
  allComplete: boolean;
}

const IDENTITY_PATH_SLOTS: Record<IdentityPath, string[]> = {
  list_a: ['list_a'],
  list_b_c: ['list_b', 'list_c'],
};

/** "2 attachments"; a lone attachment shows its file name instead. */
export function attachmentSummary(attachments: UploadedFile[]): string {
  if (attachments.length === 1) return attachments[0].name;
  return `${attachments.length} attachments`;
}

export function buildDocumentChecklist(input: {
  requiredSlots: DocumentSlotDef[];
  optionalSlots?: DocumentSlotDef[];
  identityPath: IdentityPath | null;
  documents: UploadedDocuments;
  /** The session's formData, for requirements holding several attachments. */
  formData?: Record<string, unknown>;
}): DocumentChecklist {
  const { requiredSlots, optionalSlots = [], identityPath, documents, formData } = input;
  const identityRequired = requiredSlots.some((s) => s.group === 'identity');
  const toItem = (slot: DocumentSlotDef, group: ChecklistItem['group'], optional = false): ChecklistItem => {
    const file = documents[slot.formDataField] ?? null;
    const stored = formData ? documentAttachmentsFor(formData, slot.docType) : [];
    const attachments = stored.length > 0 ? stored : file ? [file] : [];
    return { docType: slot.docType, slot, file, attachments, done: !!file, group, optional };
  };

  const identityItems = identityRequired && identityPath
    ? IDENTITY_PATH_SLOTS[identityPath]
        .map((docType) => requiredSlots.find((s) => s.docType === docType))
        .filter((s): s is DocumentSlotDef => !!s)
        .map((slot) => toItem(slot, 'identity'))
    : [];
  const credentialItems = requiredSlots.filter((s) => s.group !== 'identity').map((slot) => toItem(slot, 'credential'));
  const items = [...identityItems, ...credentialItems, ...optionalSlots.map((slot) => toItem(slot, 'credential', true))];

  const needsIdentityChoice = identityRequired && !identityPath;
  const identityDone = identityRequired && !!identityPath && identityItems.every((i) => i.done);
  const completedRequired = (identityDone ? 1 : 0) + credentialItems.filter((i) => i.done).length;
  const totalRequired = (identityRequired ? 1 : 0) + credentialItems.length;

  return {
    identityRequired,
    needsIdentityChoice,
    items,
    activeDocType: needsIdentityChoice ? null : (items.find((i) => !i.done && !i.optional)?.docType ?? null),
    completedRequired,
    totalRequired,
    allComplete: completedRequired === totalRequired,
  };
}
