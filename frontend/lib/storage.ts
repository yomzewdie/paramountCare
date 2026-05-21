import type {
  OnboardingFormData,
  OnboardingStep,
  PersonalInfo,
  I9Data,
  EmploymentReference,
  SafetyEducationData,
  SignatureData,
} from '@/types/onboarding';

const FORM_KEY = 'pcs_onboarding_v2';
const STEP_KEY = 'pcs_onboarding_step_v2';

// File objects cannot be serialized — store metadata only.
interface StorableUploadedFile {
  name: string;
  size: number;
  type: string;
}

interface StorableFormData {
  personalInfo: PersonalInfo;
  i9Data: I9Data;
  employmentReference: EmploymentReference;
  safetyEducation: SafetyEducationData;
  signatureData: SignatureData;
  uploadedDocuments: {
    listA: StorableUploadedFile | null;
    listB: StorableUploadedFile | null;
    listC: StorableUploadedFile | null;
    nursingLicense: StorableUploadedFile | null;
    cprCertification: StorableUploadedFile | null;
  };
}

function toStorable(data: OnboardingFormData): StorableFormData {
  const stripFile = (f: OnboardingFormData['uploadedDocuments'][keyof OnboardingFormData['uploadedDocuments']]) =>
    f ? { name: f.name, size: f.size, type: f.type } : null;

  return {
    personalInfo: data.personalInfo,
    i9Data: data.i9Data,
    employmentReference: data.employmentReference,
    safetyEducation: data.safetyEducation,
    signatureData: data.signatureData,
    uploadedDocuments: {
      listA:            stripFile(data.uploadedDocuments.listA),
      listB:            stripFile(data.uploadedDocuments.listB),
      listC:            stripFile(data.uploadedDocuments.listC),
      nursingLicense:   stripFile(data.uploadedDocuments.nursingLicense),
      cprCertification: stripFile(data.uploadedDocuments.cprCertification),
    },
  };
}

function restoreFile(f: StorableUploadedFile | null) {
  return f ? { ...f, restoredFromCache: true } : null;
}

function fromStorable(stored: StorableFormData): OnboardingFormData {
  return {
    personalInfo: stored.personalInfo,
    i9Data: stored.i9Data,
    employmentReference: stored.employmentReference,
    safetyEducation: stored.safetyEducation,
    signatureData: stored.signatureData,
    uploadedDocuments: {
      listA:            restoreFile(stored.uploadedDocuments.listA),
      listB:            restoreFile(stored.uploadedDocuments.listB),
      listC:            restoreFile(stored.uploadedDocuments.listC),
      nursingLicense:   restoreFile(stored.uploadedDocuments.nursingLicense),
      cprCertification: restoreFile(stored.uploadedDocuments.cprCertification),
    },
  };
}

export function saveOnboardingData(data: OnboardingFormData, step: OnboardingStep): void {
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify(toStorable(data)));
    localStorage.setItem(STEP_KEY, step);
  } catch {
    // localStorage unavailable (private browsing, storage full, SSR)
  }
}

export interface RestoredSession {
  formData: OnboardingFormData;
  step: OnboardingStep;
}

export function loadOnboardingData(): RestoredSession | null {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    const step = localStorage.getItem(STEP_KEY) as OnboardingStep | null;
    if (!raw) return null;
    const stored: StorableFormData = JSON.parse(raw);
    return {
      formData: fromStorable(stored),
      step: step ?? 'personal',
    };
  } catch {
    return null;
  }
}

export function clearOnboardingData(): void {
  try {
    localStorage.removeItem(FORM_KEY);
    localStorage.removeItem(STEP_KEY);
  } catch {
    // ignore
  }
}
