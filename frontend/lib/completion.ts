import type { OnboardingFormData, AcknowledgementEntry } from '@/types/onboarding';

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

function employmentApplicationCompletion(data: OnboardingFormData['employmentApplication'] | undefined): StepCompletion {
  if (!data) return { step: 'employment_application', completed: 0, total: 17, percent: 0 };
  let completed = 0;
  if (data.positionApplied.trim()) completed++;
  if (data.specialtyPreference.trim()) completed++;
  if (data.shiftPreference) completed++;
  if (data.employmentType) completed++;
  if (data.licenseType) completed++;
  if (data.licenseNumber.trim()) completed++;
  if (data.licenseState) completed++;
  if (data.licenseExpiration.trim()) completed++;
  if (data.yearsExperience) completed++;
  if (data.primarySpecialty.trim()) completed++;
  if (data.authorizedToWork === true) completed++;
  if (data.hasConviction !== null) completed++;
  if (data.hasLicenseDiscipline !== null) completed++;
  if (data.hasLicenseRevocation !== null) completed++;
  if (data.underInvestigation !== null) completed++;
  if (data.emergencyContactName.trim()) completed++;
  if (data.emergencyContactRelationship.trim()) completed++;
  if (data.emergencyContactPhone.trim()) completed++;
  const total = 18;
  return { step: 'employment_application', completed, total, percent: pct(completed, total) };
}

function personalCompletion(data: OnboardingFormData['personalInfo']): StepCompletion {
  const { completed, total } = countStrings([
    data.firstName, data.lastName,
    data.email, data.phone,
    data.address, data.city, data.state, data.zip,
  ]);
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

function employmentCompletion(data: OnboardingFormData, stepId: string): StepCompletion {
  const ref = data.employmentReferences?.[stepId];
  if (!ref) return { step: stepId, completed: 0, total: 11, percent: 0 };
  let completed = 0;
  if (ref.positionHeld.trim()) completed++;
  if (ref.employmentDateFrom.trim()) completed++;
  if (ref.employmentDateTo.trim()) completed++;
  if (ref.employerName.trim()) completed++;
  if (ref.employerCity.trim()) completed++;
  if (ref.employerState.trim()) completed++;
  if (ref.supervisorName.trim()) completed++;
  if (ref.supervisorPhone.trim()) completed++;
  if (ref.permissionGranted) completed++;
  if (ref.reasonForLeaving.trim()) completed++;
  if (ref.eligibleForRehire !== null) completed++;
  const total = 11;
  return { step: stepId, completed, total, percent: pct(completed, total) };
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
      return { step: stepId, completed: 1, total: 1, percent: 100 };
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
    { id: 'direct_deposit',         sig: true,  declination: false },
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
    'employment_ref_1':       employmentCompletion(data, 'employment_ref_1'),
    'employment_ref_2':       employmentCompletion(data, 'employment_ref_2'),
    'employment_ref_3':       employmentCompletion(data, 'employment_ref_3'),
    'safety_acknowledgements': safetyCompletion(data.safetyEducation),
    'documents':              documentsCompletion(data.uploadedDocuments),
    'review':                 { step: 'review', completed: 1, total: 1, percent: 100 },
  };
}

export function computeOverallCompletion(data: OnboardingFormData): number {
  const completions = computeStepCompletion(data);
  const contentSteps = [
    'personal_info', 'employment_application', 'w4', 'i9', 'employment_ref_1', 'employment_ref_2',
    'safety_acknowledgements', 'documents',
  ];
  const total     = contentSteps.reduce((sum, s) => sum + (completions[s]?.total     ?? 0), 0);
  const completed = contentSteps.reduce((sum, s) => sum + (completions[s]?.completed ?? 0), 0);
  return pct(completed, total);
}
