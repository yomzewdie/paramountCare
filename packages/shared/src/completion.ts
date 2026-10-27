import type { OnboardingFormData, AcknowledgementEntry } from './onboarding';
import { defaultEmploymentReference } from './onboarding';
import type { OnboardingPacket } from './packets';
import {
  EMPLOYMENT_TYPE_OPTIONS,
  LICENSE_TYPE_OPTIONS,
  POSITION_OPTIONS,
  SHIFT_PREFERENCE_OPTIONS,
  activeSpecialtySelections,
  isOptionValue,
  normalizeEmploymentApplication,
  requiresUnitPreference,
} from './employmentApplication';
import { isValidIsoDate } from './dates';
import { validatePersonalInfo } from './validation';

export interface StepCompletion {
  step: string;   // packet step ID
  completed: number;
  total: number;
  percent: number;
}

function pct(completed: number, total: number) {
  return total === 0 ? 100 : Math.round((completed / total) * 100);
}

function countStrings(values: string[]): { completed: number; total: number } {
  return {
    completed: values.filter((v) => v.trim().length > 0).length,
    total: values.length,
  };
}

// Counts an item only once it would pass validateEmploymentApplication(), so
// 100% always means "valid". The unit preference item is not part of the
// denominator for a CNA (never asked), and a hidden selection never counts.
function employmentApplicationCompletion(raw: OnboardingFormData['employmentApplication'] | undefined): StepCompletion {
  const data = normalizeEmploymentApplication(raw);
  const asksUnits = requiresUnitPreference(data.positionApplied);
  const items: boolean[] = [
    isOptionValue(POSITION_OPTIONS, data.positionApplied),
    ...(asksUnits ? [activeSpecialtySelections(data.positionApplied, data.specialtyPreference).length > 0] : []),
    data.shiftPreference.length > 0 && data.shiftPreference.every((v) => isOptionValue(SHIFT_PREFERENCE_OPTIONS, v)),
    data.employmentType.length > 0 && data.employmentType.every((v) => isOptionValue(EMPLOYMENT_TYPE_OPTIONS, v)),
    isOptionValue(LICENSE_TYPE_OPTIONS, data.licenseType),
    !!data.licenseNumber.trim(),
    !!data.licenseState,
    isValidIsoDate(data.licenseExpiration),
    data.authorizedToWork === true,
    data.hasConviction !== null,
    data.hasLicenseDiscipline !== null,
    data.hasLicenseRevocation !== null,
    data.underInvestigation !== null,
    !!data.emergencyContactName.trim(),
    !!data.emergencyContactRelationship.trim(),
    !!data.emergencyContactPhone.trim(),
  ];
  const completed = items.filter(Boolean).length;
  const total = items.length;
  return { step: 'employment_application', completed, total, percent: pct(completed, total) };
}

function personalCompletion(data: OnboardingFormData['personalInfo']): StepCompletion {
  const strings = countStrings([
    data.firstName, data.lastName,
    data.email, data.phone,
    data.address, data.city, data.state, data.zip,
  ]);
  // DOB counts only once it passes the same rule validation applies
  // (a real date, applicant at least 18).
  const dobOk = !!data.dateOfBirth && !validatePersonalInfo(data).dateOfBirth;
  const completed = strings.completed + (dobOk ? 1 : 0);
  const total = strings.total + 1;
  return { step: 'personal_info', completed, total, percent: pct(completed, total) };
}

function w4Completion(data: OnboardingFormData['w4Data']): StepCompletion {
  const required = [
    data.firstNameMI, data.lastName, data.ssn,
    data.address, data.cityStateZip, data.filingStatus,
    data.typedSignature, data.signedDate,
  ];
  const completed = required.filter((v) => v.trim().length > 0).length;
  const total = required.length;
  return { step: 'w4', completed, total, percent: pct(completed, total) };
}

function i9Completion(data: OnboardingFormData['i9Data']): StepCompletion {
  let completed = 0;
  if (data.dateOfBirth.trim()) completed++;
  if (data.citizenshipStatus) completed++;
  const hasSig =
    (data.i9SignatureType === 'drawn' && !!data.i9SignatureDataUrl) ||
    (data.i9SignatureType === 'typed' && !!data.i9TypedSignature.trim());
  if (hasSig) completed++;
  const total = 3;
  return { step: 'i9', completed, total, percent: pct(completed, total) };
}

// Mirrors validateEmploymentReference(): who to contact + permission. The
// optional email and any legacy work-history fields never count.
function employmentCompletion(data: OnboardingFormData, stepId: string): StepCompletion {
  const total = 5;
  const stored = data.employmentReferences?.[stepId];
  if (!stored) return { step: stepId, completed: 0, total, percent: 0 };
  const ref = { ...defaultEmploymentReference, ...stored };
  let completed = 0;
  if (ref.supervisorName.trim()) completed++;
  if (ref.supervisorTitle.trim()) completed++;
  if (ref.employerName.trim()) completed++;
  if (ref.supervisorPhone.trim()) completed++;
  if (ref.permissionGranted) completed++;
  return { step: stepId, completed, total, percent: pct(completed, total) };
}

function resumeCompletion(file: OnboardingFormData['resumeDocument'] | undefined): StepCompletion {
  const completed = file ? 1 : 0;
  return { step: 'resume', completed, total: 1, percent: pct(completed, 1) };
}

function safetyCompletion(data: OnboardingFormData['safetyEducation']): StepCompletion {
  const booleans = [
    data.patientSafety, data.infectionControl, data.fireSafety,
    data.patientRightsHipaa, data.workplaceViolence, data.backSafety,
    data.hazardousMaterials, data.documentationStandards, data.examAttestation,
  ];
  const completed = booleans.filter(Boolean).length;
  const total = booleans.length;
  return { step: 'safety_acknowledgements', completed, total, percent: pct(completed, total) };
}

/**
 * Direct Deposit's own completion calculation (M13) — replaces the generic
 * acknowledgement-style entry the `ackSteps` list used to carry for this
 * step id, since the real business model (sourced from the Paramount
 * Direct Deposit Authorization form, see validation.ts) has nothing to do
 * with a checkbox/typed-signature acknowledgement: it's a name, a primary
 * bank account, a signed authorization, and a required voided-check proof.
 * The optional second ("Additional Bank Information") account never
 * appears in the denominator — an applicant with only one account can
 * still reach 100%, matching validateDirectDeposit()'s own "only validate
 * it if the applicant started filling it in" rule.
 */
function directDepositCompletion(
  data: OnboardingFormData['directDepositData'] | undefined,
  proofDocument: OnboardingFormData['directDepositProofDocument'] | undefined,
): StepCompletion {
  const total = 10;
  if (!data) {
    const completed = proofDocument ? 1 : 0;
    return { step: 'direct_deposit', completed, total, percent: pct(completed, total) };
  }
  let completed = 0;
  if (data.lastName.trim()) completed++;
  if (data.firstName.trim()) completed++;
  if (data.primaryAccount.bankName.trim()) completed++;
  if (data.primaryAccount.accountType) completed++;
  if (data.primaryAccount.routingNumber.trim()) completed++;
  if (data.primaryAccount.accountNumber.trim()) completed++;
  if (data.primaryAccount.depositType && data.primaryAccount.depositAmount.trim()) completed++;
  if (data.typedSignature.trim()) completed++;
  if (data.signedDate.trim()) completed++;
  if (proofDocument) completed++;
  return { step: 'direct_deposit', completed, total, percent: pct(completed, total) };
}

// M14: mirrors validateDocuments()'s own required set exactly (I-9 identity
// — List A alone, or List B + List C together — plus nursing license and
// CPR/BLS certification), sourced from packets.ts's `documents` step
// config, which is identical across every packet today. Each of the 5
// individual UploadedFile fields only ever gets set via the
// ownership-verified session-association endpoint, never by a local
// selection alone, so "completed" here can never mean "picked but not
// actually uploaded."
function documentsCompletion(data: OnboardingFormData['uploadedDocuments']): StepCompletion {
  const creds = [data.nursingLicense, data.cprCertification].filter(Boolean).length;
  const i9 = (!!data.listA || (!!data.listB && !!data.listC)) ? 1 : 0;
  const completed = i9 + creds;
  const total = 3;
  return { step: 'documents', completed, total, percent: pct(completed, total) };
}

function acknowledgementsCompletion(
  data: OnboardingFormData,
  stepId: string,
  requiresSignature: boolean,
  hasDeclination?: boolean,
): StepCompletion {
  const entry: AcknowledgementEntry | undefined = data.acknowledgements[stepId];

  if (hasDeclination) {
    if (!entry?.decision) return { step: stepId, completed: 0, total: 1, percent: 0 };
    if (entry.decision === 'providing_proof') {
      // Providing proof is only complete once the evidence is uploaded.
      const uploaded = data.vaccineProofDocuments?.[stepId] ? 1 : 0;
      return { step: stepId, completed: uploaded, total: 1, percent: pct(uploaded, 1) };
    }
    // Declining path — same requirements as a regular signed acknowledgement
    let completed = 0;
    const total = requiresSignature ? 2 : 1;
    if (entry.checked) completed++;
    if (requiresSignature && entry.typedSignature?.trim()) completed++;
    return { step: stepId, completed, total, percent: pct(completed, total) };
  }

  let completed = 0;
  const total = requiresSignature ? 2 : 1;
  if (entry?.checked) completed++;
  if (requiresSignature && entry?.typedSignature?.trim()) completed++;
  return { step: stepId, completed, total, percent: pct(completed, total) };
}

export function computeStepCompletion(data: OnboardingFormData): Record<string, StepCompletion> {
  const ackSteps = [
    { id: 'employment_application', sig: true,  declination: false },
    { id: 'application_statement',  sig: true,  declination: false },
    { id: 'background_auth',        sig: true,  declination: false },
    { id: 'health_info_auth',       sig: true,  declination: false },
    { id: 'patient_bill_of_rights', sig: true,  declination: false },
    { id: 'hep_b_declination',      sig: true,  declination: true  },
    { id: 'tdap_declination',       sig: true,  declination: true  },
    { id: 'flu_declination',        sig: true,  declination: true  },
    { id: 'w4',                     sig: true,  declination: false },
    { id: 'jcaho_review',           sig: true,  declination: false },
  ];

  const ackCompletions: Record<string, StepCompletion> = {};
  for (const { id, sig, declination } of ackSteps) {
    ackCompletions[id] = acknowledgementsCompletion(data, id, sig, declination);
  }

  return {
    ...ackCompletions,
    'personal_info':           personalCompletion(data.personalInfo),
    'employment_application':  employmentApplicationCompletion(data.employmentApplication),
    'w4':                     w4Completion(data.w4Data),
    'i9':                     i9Completion(data.i9Data),
    'direct_deposit':         directDepositCompletion(data.directDepositData, data.directDepositProofDocument),
    'employment_ref_1':       employmentCompletion(data, 'employment_ref_1'),
    'employment_ref_2':       employmentCompletion(data, 'employment_ref_2'),
    'employment_ref_3':       employmentCompletion(data, 'employment_ref_3'),
    'safety_acknowledgements': safetyCompletion(data.safetyEducation),
    'documents':              documentsCompletion(data.uploadedDocuments),
    'resume':                 resumeCompletion(data.resumeDocument),
    'review':                 { step: 'review', completed: 1, total: 1, percent: 100 },
  };
}

/**
 * Overall completion percentage, driven entirely by the applicant's ACTUAL
 * packet — never a hardcoded step-id list (M10 added two steps to such a
 * list by hand; M11 replaces the list itself, since a fixed array can
 * never correctly represent packets that only partially overlap, like
 * General RN/LVN's `health_info_auth` vs. ICU/ER/Travel's `w4` branch).
 *
 * A step counts toward the denominator when it is:
 *  1. actually present in this packet (`packet.steps`) — a step absent
 *     from the applicant's packet can never count, positively or
 *     negatively;
 *  2. `required` — an optional step (e.g. Travel RN's `employment_ref_3`)
 *     never lowers the percentage by being incomplete, and completing it
 *     is never necessary to reach 100%;
 *  3. not `type: 'review'` — a review/submit gate isn't itself
 *     "content" the applicant fills in, so it doesn't participate;
 *  4. present in `computeStepCompletion()`'s output — a step type with no
 *     defined completion calculation (today: `exam`, e.g. the optional
 *     `safety_exam`) is excluded by construction rather than guessed at,
 *     since counting it either way without a real algorithm would be
 *     inventing a rule the shared domain model doesn't actually define.
 */
export function computeOverallCompletion(packet: OnboardingPacket, data: OnboardingFormData): number {
  const completions = computeStepCompletion(data);
  const contentSteps = packet.steps.filter(
    (s) => s.required && s.type !== 'review' && completions[s.id] !== undefined,
  );
  const total     = contentSteps.reduce((sum, s) => sum + completions[s.id].total, 0);
  const completed = contentSteps.reduce((sum, s) => sum + completions[s.id].completed, 0);
  return pct(completed, total);
}
