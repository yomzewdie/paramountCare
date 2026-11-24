import type { OnboardingFormData } from './onboarding';
import type { OnboardingPacket, PacketStep } from './packets';
import {
  DIRECT_DEPOSIT_DOC_TYPE,
  DRIVERS_LICENSE_DOC_TYPE,
  RESUME_DOC_TYPE,
  SOCIAL_SECURITY_CARD_DOC_TYPE,
  VACCINE_PROOF_STEP_BY_DOC_TYPE,
  documentAttachmentsFor,
  i9ReuseSource,
  i9SlotFilled,
} from './documentAttachments';

// ── Required documents as logical requirements ───────────────────────────────
//
// The one definition of which documents an applicant still owes. A
// requirement is one logical document however many attachments it holds
// (license front + back is one), and only requirements that are active for
// THIS applicant count:
//  - Resume (the resume step);
//  - I-9 identity: List A, or List B + List C together — one requirement.
//    List B / List C may be filled by the applicant's explicit choice to
//    reuse their Identity Documents Driver's License / Social Security card
//    (documentAttachments.ts i9ReuseSource); the I-9 requirement still counts
//    once, and the Identity Documents requirements count on their own;
//  - each `requiredUploads` document: CPR/BLS, and the Identity Documents
//    step's Driver's License and Social Security Card (Paramount Care's own
//    onboarding requirement — never part of the I-9 calculation);
//    `optionalUploads` (the professional license) never count;
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
  /** Every doc type whose files make it up (identity: List A, B and C, plus
   * an Identity Documents upload the applicant chose to reuse for List B/C). */
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
      const filled = (docType: string) => i9SlotFilled(formData as Record<string, unknown> | null | undefined, docType, has);
      groups.push(group(I9_IDENTITY_REQUIREMENT, i9IdentityDocTypes(formData), filled('list_a') || (filled('list_b') && filled('list_c'))));
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

/** The I-9 identity requirement's doc types for this applicant: List A, B
 * and C, plus any Identity Documents upload chosen to stand in for B or C. */
export function i9IdentityDocTypes(formData: FormDataLike): string[] {
  const reused = (['list_b', 'list_c'] as const)
    .map((docType) => i9ReuseSource(formData as Record<string, unknown> | null | undefined, docType))
    .filter((docType): docType is string => !!docType);
  return ['list_a', 'list_b', 'list_c', ...reused];
}

/**
 * The packet as it applies to one session. An application is held to the
 * steps it was submitted under: a step added to the packet later (`addedLater`,
 * e.g. Identity Documents) that a SUBMITTED session never completed is left
 * out, so it never adds a requirement, an incomplete step or a clearance
 * blocker to an application that was already submitted. Every other step —
 * and every step of a session still in progress — applies as always.
 */
export function stepsInForce(packet: OnboardingPacket, session: { status?: string | null; stepStates?: Record<string, unknown> | null }): OnboardingPacket {
  if (session.status !== 'submitted') return packet;
  const steps = packet.steps.filter((step) => !step.addedLater || session.stepStates?.[step.id] === 'completed');
  return steps.length === packet.steps.length ? packet : { ...packet, steps };
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
  [DRIVERS_LICENSE_DOC_TYPE]: "Driver's License",
  [SOCIAL_SECURITY_CARD_DOC_TYPE]: 'Social Security Card',
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
