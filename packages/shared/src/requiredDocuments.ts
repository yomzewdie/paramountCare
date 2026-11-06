import type { OnboardingFormData } from './onboarding';
import type { OnboardingPacket, PacketStep } from './packets';
import {
  DIRECT_DEPOSIT_DOC_TYPE,
  RESUME_DOC_TYPE,
  VACCINE_PROOF_STEP_BY_DOC_TYPE,
  documentAttachmentsFor,
} from './documentAttachments';

// ── Required documents as logical requirements ───────────────────────────────
//
// The one definition of which documents an applicant still owes. A
// requirement is one logical document however many attachments it holds
// (license front + back is one), and only requirements that are active for
// THIS applicant count:
//  - Resume (the resume step);
//  - I-9 identity: List A, or List B + List C together — one requirement;
//  - each `requiredUploads` credential (CPR/BLS); `optionalUploads` (the
//    professional license) never count;
//  - Direct Deposit bank verification;
//  - vaccination proof only where the applicant's answer is "providing proof".
// Only the packet's required steps contribute.
//
// Whether a document "is there" is the caller's question: by default the
// session's stored references; final submission passes the upload ledger.

export const I9_IDENTITY_REQUIREMENT = 'i9_identity';

export interface RequiredDocumentGroup {
  /** The requirement: a doc type, or I9_IDENTITY_REQUIREMENT. */
  key: string;
  /** The packet step it belongs to. */
  stepId: string;
  /** Every doc type that can hold files for it (identity: List A, B and C). */
  docTypes: string[];
  satisfied: boolean;
}

export interface RequiredDocumentSummary {
  total: number;
  completed: number;
  remaining: number;
}

/** Whether at least one file is held for a doc type. */
export type HasDocument = (docType: string) => boolean;

type FormDataLike = OnboardingFormData | Record<string, unknown> | null | undefined;

/** Answers from the session's stored document references. */
export function hasStoredDocument(formData: FormDataLike): HasDocument {
  return (docType) => documentAttachmentsFor(formData as Record<string, unknown> | null | undefined, docType).length > 0;
}

function vaccineProofDocType(stepId: string): string | undefined {
  return Object.keys(VACCINE_PROOF_STEP_BY_DOC_TYPE).find((docType) => VACCINE_PROOF_STEP_BY_DOC_TYPE[docType] === stepId);
}

function acknowledgementDecision(formData: FormDataLike, stepId: string): unknown {
  const acknowledgements = (formData as { acknowledgements?: Record<string, { decision?: unknown } | undefined> } | null | undefined)?.acknowledgements;
  return acknowledgements?.[stepId]?.decision;
}

/** The document requirements one step currently asks for (none for most steps). */
export function requiredDocumentGroupsForStep(step: PacketStep, formData: FormDataLike, has: HasDocument = hasStoredDocument(formData)): RequiredDocumentGroup[] {
  const group = (key: string, docTypes: string[], satisfied: boolean): RequiredDocumentGroup => ({ key, stepId: step.id, docTypes, satisfied });

  if (step.type === 'document_upload') {
    if (step.subtype === 'resume') return [group(RESUME_DOC_TYPE, [RESUME_DOC_TYPE], has(RESUME_DOC_TYPE))];
    const groups: RequiredDocumentGroup[] = [];
    if (step.config?.i9Uploads) {
      groups.push(group(I9_IDENTITY_REQUIREMENT, ['list_a', 'list_b', 'list_c'], has('list_a') || (has('list_b') && has('list_c'))));
    }
    for (const docType of step.config?.requiredUploads ?? []) groups.push(group(docType, [docType], has(docType)));
    return groups;
  }
  if (step.type === 'internal_form' && step.subtype === 'direct_deposit') {
    return [group(DIRECT_DEPOSIT_DOC_TYPE, [DIRECT_DEPOSIT_DOC_TYPE], has(DIRECT_DEPOSIT_DOC_TYPE))];
  }
  if (step.config?.hasDeclination && acknowledgementDecision(formData, step.id) === 'providing_proof') {
    const docType = vaccineProofDocType(step.id);
    if (docType) return [group(docType, [docType], has(docType))];
  }
  return [];
}

/** Every document requirement active for this applicant, across the packet's required steps. */
export function requiredDocumentGroups(packet: OnboardingPacket, formData: FormDataLike, has: HasDocument = hasStoredDocument(formData)): RequiredDocumentGroup[] {
  return packet.steps.filter((step) => step.required).flatMap((step) => requiredDocumentGroupsForStep(step, formData, has));
}

export function summarizeRequiredDocuments(groups: readonly RequiredDocumentGroup[]): RequiredDocumentSummary {
  const completed = groups.filter((g) => g.satisfied).length;
  return { total: groups.length, completed, remaining: groups.length - completed };
}

// ── Review: logical requirements an admin accepts or sends back ─────────────
//
// Reviewed as a whole: the I-9 identity requirement (List A, or List B + C)
// is one review, and so is a requirement holding several attachments. What
// can be reviewed is every required requirement plus any optional one the
// applicant actually uploaded to (the professional license).

/** The requirement a document type belongs to. */
export function requirementForDocType(docType: string): string {
  return docType === 'list_a' || docType === 'list_b' || docType === 'list_c' ? I9_IDENTITY_REQUIREMENT : docType;
}

/** Doc types whose files make up a requirement. */
export function docTypesForRequirement(requirement: string): string[] {
  return requirement === I9_IDENTITY_REQUIREMENT ? ['list_a', 'list_b', 'list_c'] : [requirement];
}

export interface ReviewableRequirement extends RequiredDocumentGroup {
  required: boolean;
}

/** Required requirements (whether or not they have files yet), then optional
 * ones that have files. */
export function reviewableRequirements(packet: OnboardingPacket, formData: FormDataLike, has: HasDocument = hasStoredDocument(formData)): ReviewableRequirement[] {
  const required = requiredDocumentGroups(packet, formData, has).map((g) => ({ ...g, required: true }));
  const optional = packet.steps
    .filter((step) => step.required && step.type === 'document_upload')
    .flatMap((step) => (step.config?.optionalUploads ?? []).map((docType) => ({ key: docType, stepId: step.id, docTypes: [docType], satisfied: has(docType), required: false })))
    .filter((g) => g.satisfied);
  return [...required, ...optional];
}

/** Applicant-facing names for each requirement (emails, the app). */
export const DOCUMENT_REQUIREMENT_LABELS: Readonly<Record<string, string>> = {
  applicant_resume: 'Resume',
  [I9_IDENTITY_REQUIREMENT]: 'I-9 identity document',
  list_a: 'I-9 List A document',
  list_b: 'I-9 List B document',
  list_c: 'I-9 List C document',
  cpr_cert: 'CPR / BLS certification',
  nursing_license: 'Professional license / certification',
  direct_deposit_voided_check: 'Bank account verification (Direct Deposit)',
  hep_b_vaccination_proof: 'Hepatitis B vaccination proof',
  tdap_vaccination_proof: 'Tdap vaccination proof',
  flu_vaccination_proof: 'Influenza vaccination proof',
};

export function documentRequirementLabel(requirement: string): string {
  return DOCUMENT_REQUIREMENT_LABELS[requirement] ?? requirement;
}
