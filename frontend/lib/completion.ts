import type { OnboardingFormData, OnboardingStep } from '@/types/onboarding';

export interface StepCompletion {
  step: OnboardingStep;
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

function personalCompletion(data: OnboardingFormData['personalInfo']): StepCompletion {
  // Required I-9 fields
  const { completed, total } = countStrings([
    data.firstName, data.lastName, data.dateOfBirth,
    data.email, data.phone,
    data.address, data.city, data.state, data.zip,
  ]);
  return { step: 'personal', completed, total, percent: pct(completed, total) };
}

function i9Completion(data: OnboardingFormData['i9Data']): StepCompletion {
  // Minimum: status selected + attestation
  let completed = 0;
  if (data.citizenshipStatus) completed++;
  if (data.attestationAcknowledged) completed++;
  const total = 2;
  return { step: 'i9', completed, total, percent: pct(completed, total) };
}

function employmentCompletion(data: OnboardingFormData['employmentReference']): StepCompletion {
  let completed = 0;
  if (data.positionHeld.trim()) completed++;
  if (data.employmentDateFrom.trim()) completed++;
  if (data.employmentDateTo.trim()) completed++;
  if (data.employerName.trim()) completed++;
  if (data.employerCity.trim()) completed++;
  if (data.employerState.trim()) completed++;
  if (data.supervisorName.trim()) completed++;
  if (data.supervisorPhone.trim()) completed++;
  if (data.permissionGranted) completed++;
  const total = 9;
  return { step: 'employment', completed, total, percent: pct(completed, total) };
}

function safetyCompletion(data: OnboardingFormData['safetyEducation']): StepCompletion {
  const booleans = [
    data.patientSafety, data.infectionControl, data.fireSafety,
    data.patientRightsHipaa, data.workplaceViolence, data.backSafety,
    data.hazardousMaterials, data.documentationStandards, data.examAttestation,
  ];
  const completed = booleans.filter(Boolean).length;
  const total = booleans.length;
  return { step: 'safety', completed, total, percent: pct(completed, total) };
}

function documentsCompletion(data: OnboardingFormData['uploadedDocuments']): StepCompletion {
  const creds = [data.nursingLicense, data.cprCertification].filter(Boolean).length;
  const i9 = (!!data.listA || (!!data.listB && !!data.listC)) ? 1 : 0;
  const completed = i9 + creds;
  const total = 3;
  return { step: 'documents', completed, total, percent: pct(completed, total) };
}

function signatureCompletion(data: OnboardingFormData['signatureData']): StepCompletion {
  const has = (data.signatureDataUrl && data.signatureDataUrl !== '') || data.typedName.trim().length > 0;
  return { step: 'signature', completed: has ? 1 : 0, total: 1, percent: has ? 100 : 0 };
}

export function computeStepCompletion(data: OnboardingFormData): Record<OnboardingStep, StepCompletion> {
  return {
    personal:   personalCompletion(data.personalInfo),
    i9:         i9Completion(data.i9Data),
    employment: employmentCompletion(data.employmentReference),
    safety:     safetyCompletion(data.safetyEducation),
    documents:  documentsCompletion(data.uploadedDocuments),
    signature:  signatureCompletion(data.signatureData),
    review:     { step: 'review', completed: 1, total: 1, percent: 100 },
  };
}

export function computeOverallCompletion(data: OnboardingFormData): number {
  const completions = computeStepCompletion(data);
  const steps: OnboardingStep[] = ['personal', 'i9', 'employment', 'safety', 'documents', 'signature'];
  const total = steps.reduce((sum, s) => sum + completions[s].total, 0);
  const completed = steps.reduce((sum, s) => sum + completions[s].completed, 0);
  return pct(completed, total);
}
