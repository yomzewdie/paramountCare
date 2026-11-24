import type { UploadedFile } from './onboarding';

// ── Document requirements as attachment groups ───────────────────────────────
//
// One logical document requirement (an upload slot, identified by its
// doc_type) can hold one or more attachments: license front + back, a
// multi-page record, several dose cards.
//
// Purely additive to the stored shape. Every requirement keeps its existing
// single-file field (`uploadedDocuments.nursingLicense`, `resumeDocument`, …),
// which always holds the group's FIRST attachment, so validation, completion
// and historical applications keep reading what they have always read. The
// full list is only stored under `documentAttachments[docType]` once a group
// has two or more files — a single attachment stays byte-for-byte the shape
// it has always been, and a stored single file simply reads back as a
// one-item group. Nothing is ever rewritten in place.
//
// All of this document state is server-owned: the generic session PATCH
// discards any client-sent value (worker/src/routes/sessions.ts), so every
// entry got there through the ownership-verified association route.

/** Upper bound per requirement, enforced by the Worker. Generous for any real
 * document (a merged scan counts as one) while keeping one requirement from
 * growing without limit. */
export const MAX_ATTACHMENTS_PER_DOCUMENT = 20;

/** Recruiter-provided license verification. Admin-only: never an applicant
 * upload slot (deliberately absent from the applicant doc types below), and
 * stored only on the submitted application. */
export const VERIFIED_LICENSE_DOC_TYPE = 'verified_license';

/** The applicant's resume stays exactly one file. */
export const RESUME_DOC_TYPE = 'applicant_resume';

/** docType (upload slot) -> the vaccine step whose answer governs it. */
export const VACCINE_PROOF_STEP_BY_DOC_TYPE: Readonly<Record<string, string>> = {
  hep_b_vaccination_proof: 'hep_b_declination',
  tdap_vaccination_proof: 'tdap_declination',
  flu_vaccination_proof: 'flu_declination',
};

/** Paramount Care's own onboarding identity documents (the Identity
 * Documents step) — an operational requirement, separate from the federal
 * Form I-9 document selection (List A, or List B + List C). */
export const DRIVERS_LICENSE_DOC_TYPE = 'drivers_license';
export const SOCIAL_SECURITY_CARD_DOC_TYPE = 'social_security_card';

const UPLOADED_DOCUMENT_FIELD_BY_DOC_TYPE: Readonly<Record<string, string>> = {
  list_a: 'listA',
  list_b: 'listB',
  list_c: 'listC',
  nursing_license: 'nursingLicense',
  cpr_cert: 'cprCertification',
  [DRIVERS_LICENSE_DOC_TYPE]: 'driversLicense',
  [SOCIAL_SECURITY_CARD_DOC_TYPE]: 'socialSecurityCard',
};

export const DIRECT_DEPOSIT_DOC_TYPE = 'direct_deposit_voided_check';

/** Every slot an applicant may attach files to. */
export const APPLICANT_DOC_TYPES: readonly string[] = [
  RESUME_DOC_TYPE,
  DIRECT_DEPOSIT_DOC_TYPE,
  ...Object.keys(UPLOADED_DOCUMENT_FIELD_BY_DOC_TYPE),
  ...Object.keys(VACCINE_PROOF_STEP_BY_DOC_TYPE),
];

/** The explicit allow-list of slots an applicant may attach files to. The
 * value comes straight from a URL, so it is matched against the list itself,
 * never with a property lookup an inherited name like `constructor` could pass. */
export function isApplicantDocType(docType: string): boolean {
  return APPLICANT_DOC_TYPES.includes(docType);
}

export function allowsMultipleAttachments(docType: string): boolean {
  return docType !== RESUME_DOC_TYPE;
}

type FormDataLike = Record<string, unknown> | null | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asFile(value: unknown): UploadedFile | null {
  return value && typeof value === 'object' ? (value as UploadedFile) : null;
}

/** The requirement's existing single-file field: its first attachment. */
function primaryAttachment(formData: FormDataLike, docType: string): UploadedFile | null {
  if (docType === RESUME_DOC_TYPE) return asFile(formData?.resumeDocument);
  if (docType === DIRECT_DEPOSIT_DOC_TYPE) return asFile(formData?.directDepositProofDocument);
  const stepId = VACCINE_PROOF_STEP_BY_DOC_TYPE[docType];
  if (stepId) return asFile(asRecord(formData?.vaccineProofDocuments)[stepId]);
  const field = UPLOADED_DOCUMENT_FIELD_BY_DOC_TYPE[docType];
  return field ? asFile(asRecord(formData?.uploadedDocuments)[field]) : null;
}

function withPrimaryAttachment(formData: Record<string, unknown>, docType: string, file: UploadedFile | null): Record<string, unknown> {
  if (docType === RESUME_DOC_TYPE) return { ...formData, resumeDocument: file };
  if (docType === DIRECT_DEPOSIT_DOC_TYPE) return { ...formData, directDepositProofDocument: file };
  const stepId = VACCINE_PROOF_STEP_BY_DOC_TYPE[docType];
  if (stepId) return { ...formData, vaccineProofDocuments: { ...asRecord(formData.vaccineProofDocuments), [stepId]: file } };
  const field = UPLOADED_DOCUMENT_FIELD_BY_DOC_TYPE[docType];
  if (field) return { ...formData, uploadedDocuments: { ...asRecord(formData.uploadedDocuments), [field]: file } };
  return formData;
}

/** Every attachment of a requirement, in order. A session or application that
 * only has the single-file field reads back as a one-item group. */
export function documentAttachmentsFor(formData: FormDataLike, docType: string): UploadedFile[] {
  const group = asRecord(formData?.documentAttachments)[docType];
  if (Array.isArray(group) && group.length > 0) return group as UploadedFile[];
  const primary = primaryAttachment(formData, docType);
  return primary ? [primary] : [];
}

/** Writes a requirement's full attachment list: the single-file field always
 * holds the first attachment, and the list itself is only stored while there
 * are two or more. */
export function withDocumentAttachments(formData: Record<string, unknown>, docType: string, files: UploadedFile[]): Record<string, unknown> {
  const next = withPrimaryAttachment(formData, docType, files[0] ?? null);
  const { [docType]: _replaced, ...otherGroups } = asRecord(formData.documentAttachments);
  const groups = files.length >= 2 ? { ...otherGroups, [docType]: files } : otherGroups;
  if (Object.keys(groups).length > 0) return { ...next, documentAttachments: groups };
  const { documentAttachments: _empty, ...rest } = next;
  return rest;
}

// ── Reusing an Identity Documents upload for the I-9 ────────────────────────
//
// An applicant who already uploaded their Driver's License or Social Security
// card in the Identity Documents step may choose to use that same upload for
// their I-9 List B or List C document instead of uploading it again. It is
// only ever the applicant's own explicit choice (never inferred from what was
// uploaded or from citizenship status), and only for the legally applicable
// pairing: a driver's license as List B; a Social Security card as List C, and
// only once the applicant confirms it carries no employment restriction.
//
// Stored as a reference by DOCUMENT TYPE within the same session
// (`formData.i9DocumentReuse.list_b = { source: 'drivers_license', … }`),
// never as an object key — so it can only ever resolve to this session's own
// files, and no file is copied or stored twice. Server-owned: written only by
// the Worker's reuse route, never by the generic session PATCH.

export interface I9DocumentReuseEntry {
  /** The Identity Documents doc type whose files stand in for this I-9 slot. */
  source: string;
  selectedAt: string;
  /** List C only: the applicant confirmed the card has no employment restriction. */
  unrestrictedConfirmed?: boolean;
}

export type I9DocumentReuse = Partial<Record<'list_b' | 'list_c', I9DocumentReuseEntry>>;

/** Anything carrying the (untrusted) reuse choice: typed form data, or the
 * raw stored JSON. Only `i9DocumentReuse` is read, and it is re-checked. */
export type I9ReuseHolder = { readonly i9DocumentReuse?: unknown } | null | undefined;

/** The one Identity Documents upload an I-9 slot may reuse, or null. Matched
 * explicitly — the value can come straight from a URL. */
export function reusableSourceForI9DocType(i9DocType: string): string | null {
  if (i9DocType === 'list_b') return DRIVERS_LICENSE_DOC_TYPE;
  if (i9DocType === 'list_c') return SOCIAL_SECURITY_CARD_DOC_TYPE;
  return null;
}

/** The doc type an I-9 slot currently reuses (the applicant chose it, for an
 * allowed pairing, with List C's restriction confirmed), or null. Says nothing
 * about whether the source still holds files — callers check that. */
export function i9ReuseSource(formData: I9ReuseHolder, i9DocType: string): string | null {
  const allowed = reusableSourceForI9DocType(i9DocType);
  if (!allowed) return null;
  const entry = asRecord(asRecord(formData?.i9DocumentReuse)[i9DocType]);
  if (entry.source !== allowed) return null;
  if (i9DocType === 'list_c' && entry.unrestrictedConfirmed !== true) return null;
  return allowed;
}

/** Sets (or, with null, clears) one I-9 slot's reuse choice. */
export function withI9Reuse(formData: Record<string, unknown>, i9DocType: 'list_b' | 'list_c', entry: I9DocumentReuseEntry | null): Record<string, unknown> {
  const { [i9DocType]: _previous, ...others } = asRecord(formData.i9DocumentReuse);
  const next = entry ? { ...others, [i9DocType]: entry } : others;
  if (Object.keys(next).length > 0) return { ...formData, i9DocumentReuse: next };
  const { i9DocumentReuse: _empty, ...rest } = formData;
  return rest;
}

/** Whether an I-9 slot is filled: its own upload, or a reused Identity
 * Documents upload that still holds files. */
export function i9SlotFilled(formData: I9ReuseHolder, i9DocType: string, has: (docType: string) => boolean): boolean {
  if (has(i9DocType)) return true;
  const source = i9ReuseSource(formData, i9DocType);
  return !!source && has(source);
}
