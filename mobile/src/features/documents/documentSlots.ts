import type { PacketStep, UploadedDocuments } from '@pcs/shared';

/**
 * One required-or-optional document requirement the applicant can satisfy
 * with a single upload. Copy (`label`/`description`/`examples`) is copied
 * verbatim from the existing web `UploadSection.tsx`'s own `I9_SLOTS`/
 * `CREDENTIAL_SLOTS` — not invented — since that's the real, already-
 * approved Paramount document catalog; only the presentation is new here.
 *
 * `docType` is the server-recognized value `POST/DELETE
 * /api/sessions/:sessionId/documents/:docType` accepts (worker/src/routes/
 * sessions.ts's `DOC_TYPE_APPLIERS`) — never invented client-side, and
 * matches the naming `application_documents.doc_type`'s own comment
 * already anticipated (migrations/0002_phase1.sql).
 */
export interface DocumentSlotDef {
  docType: string;
  formDataField: keyof UploadedDocuments;
  label: string;
  description: string;
  examples: string;
  /** Slots sharing a group satisfy ONE compound requirement together
   * (today: the I-9 identity group — List A alone, OR List B + List C).
   * Undefined means the slot is its own independent requirement. */
  group?: 'identity';
  /** Presentation badge mirroring the web UI's own OR/+ badges for the
   * identity group — purely a hint about how the group's slots relate. */
  groupBadge?: 'OR' | '+';
  /** No optional document exists in the current source/business process
   * (confirmed by reading packets.ts, completion.ts, and UploadSection.tsx
   * — all three agree on exactly the same three required items). Present
   * as a field, not a hardcoded assumption, so a future genuinely optional
   * document type only needs `optional: true` here, not new screen logic. */
  optional?: boolean;
}

export const IDENTITY_SLOTS: DocumentSlotDef[] = [
  {
    docType: 'list_a',
    formDataField: 'listA',
    label: 'List A — Identity & Work Authorization',
    description: 'Establishes both identity and authorization to work in the U.S.',
    examples: 'U.S. Passport, Permanent Resident Card (I-551), Employment Authorization Document (I-766)',
    group: 'identity',
    groupBadge: 'OR',
  },
  {
    docType: 'list_b',
    formDataField: 'listB',
    label: 'List B — Identity Document',
    description: 'Establishes identity only. Must be combined with a List C document.',
    examples: "Driver's License, State-Issued ID Card, School ID with photograph",
    group: 'identity',
    groupBadge: '+',
  },
  {
    docType: 'list_c',
    formDataField: 'listC',
    label: 'List C — Work Authorization Document',
    description: 'Establishes authorization to work. Must be combined with a List B document.',
    examples: 'Social Security Card, U.S. Birth Certificate, Employment Authorization (DHS)',
    group: 'identity',
  },
];

export const CREDENTIAL_SLOT_BY_KEY: Record<string, DocumentSlotDef> = {
  nursing_license: {
    docType: 'nursing_license',
    formDataField: 'nursingLicense',
    label: 'Nursing License',
    description: 'Current state nursing license — RN, LPN, or other.',
    examples: 'State-issued nursing license card or official printout',
  },
  cpr_cert: {
    docType: 'cpr_cert',
    formDataField: 'cprCertification',
    label: 'CPR / BLS Certification',
    description: 'Valid Basic Life Support or CPR certification.',
    examples: 'AHA BLS card, Red Cross CPR card, or accredited provider certificate',
  },
};

/**
 * The actual required document set for THIS applicant's packet — driven
 * entirely by `step.config.i9Uploads`/`requiredUploads` (packets.ts), never
 * a hardcoded list, so a future packet with a different document set is a
 * config change there, not a code change here. Every packet's `documents`
 * step config is identical today (confirmed directly, not assumed) — this
 * function is what makes that a fact this code reads, not one it assumes.
 */
export function resolveRequiredSlots(step: PacketStep | undefined): DocumentSlotDef[] {
  const config = step?.config;
  const slots: DocumentSlotDef[] = [];
  if (config?.i9Uploads) slots.push(...IDENTITY_SLOTS);
  for (const key of config?.requiredUploads ?? []) {
    const slot = CREDENTIAL_SLOT_BY_KEY[key];
    if (slot) slots.push(slot);
  }
  return slots;
}

/** The I-9 identity requirement is satisfied by List A alone, or by both
 * List B and List C together — never by List B or List C alone. Mirrors
 * validateDocuments()/documentsCompletion() in packages/shared exactly. */
export function isIdentityGroupSatisfied(data: UploadedDocuments): boolean {
  return !!data.listA || (!!data.listB && !!data.listC);
}

// ── Identity path — List A vs. List B + List C is an alternative-group
// requirement, not three independent slots ─────────────────────────────
//
// M14 hardening: the identity documents this requirement is built from are
// sensitive (identity/work-authorization records) — the successful,
// steady-state flow should never retain both an unused List A AND an
// unused List B/C at once. `IdentityPath` names which of the two
// mutually-exclusive options the applicant is currently using; the actual
// cleanup of whichever path becomes unnecessary happens in
// `useDocumentsForm.ts`, only once the NEW path is fully, authoritatively
// satisfied — never before (see that file's own doc comment).
export type IdentityPath = 'list_a' | 'list_b_c';

/** Derives which path the applicant's session is CURRENTLY on, purely from
 * which documents already exist there — this is never stored as its own
 * field (deliberately: `identityPath` in `useDocumentsForm.ts` is
 * screen-local, re-derived fresh on every mount/app-restart, never
 * persisted); there is nothing to desynchronize from the authoritative
 * uploadedDocuments data. Returns null only when neither path has any data
 * yet (a fresh applicant who hasn't chosen or uploaded anything).
 *
 * Deterministic reconstruction when BOTH paths temporarily have data at
 * once (either a session predating this hardening pass, or an abandoned
 * in-progress switch left a stray file behind — e.g. List A still valid,
 * a lone List B sitting unused): List A always takes priority. This is a
 * display default only, never a destructive automatic cleanup of
 * pre-existing data — the "extra" side is left alone, not silently
 * deleted, and remains visible/removable if the applicant switches to it.
 * Choosing List A here also means `identityPath` resolves to a path that
 * is ALREADY complete, so Continue is immediately available on
 * reconstruction — an abandoned switch never leaves the applicant stuck
 * behind a completion gate they didn't know they were still subject to (see
 * `useDocumentsForm.ts`'s `identityPathError`). */
export function deriveCurrentIdentityPath(data: UploadedDocuments): IdentityPath | null {
  if (data.listA) return 'list_a';
  if (data.listB && data.listC) return 'list_b_c';
  return null;
}
