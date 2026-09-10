import type { StepStates } from '@pcs/shared';
import type {
  OnboardingFormData,
  PersonalInfo,
  EmploymentApplicationData,
  I9Data,
  W4Data,
  EmploymentReference,
  SafetyEducationData,
  SignatureData,
  AcknowledgementEntry,
} from '@/types/onboarding';
import { defaultFormData } from '@/types/onboarding';

// v9: employmentReference → employmentReferences (Record<string, EmploymentReference>) + new ref fields.
const SESSION_KEY = 'pcs_onboarding_v9';

// ── Storable shape (File objects are not JSON-serializable) ───────────────────

interface StorableUploadedFile {
  name: string;
  size: number;
  type: string;
  objectKey?: string;
  uploadedAt?: string;
}

interface StorableFormData {
  personalInfo: PersonalInfo;
  employmentApplication: EmploymentApplicationData;
  i9Data: I9Data;
  w4Data?: W4Data;
  employmentReferences: Record<string, EmploymentReference>;
  safetyEducation: SafetyEducationData;
  signatureData: SignatureData;
  acknowledgements: Record<string, AcknowledgementEntry>;
  vaccineProofDocuments?: Record<string, StorableUploadedFile | null>;
  uploadedDocuments: {
    listA: StorableUploadedFile | null;
    listB: StorableUploadedFile | null;
    listC: StorableUploadedFile | null;
    nursingLicense: StorableUploadedFile | null;
    cprCertification: StorableUploadedFile | null;
  };
}

interface StoredSession {
  packetId: string;
  packetVersion: number;
  currentStepId: string;
  stepStates: StepStates;
  formData: StorableFormData;
}

// ── Serialization ─────────────────────────────────────────────────────────────

function toStorable(data: OnboardingFormData): StorableFormData {
  const stripFile = (f: OnboardingFormData['uploadedDocuments'][keyof OnboardingFormData['uploadedDocuments']]) =>
    f ? { name: f.name, size: f.size, type: f.type, objectKey: f.objectKey, uploadedAt: f.uploadedAt } : null;

  return {
    personalInfo:          data.personalInfo,
    employmentApplication: data.employmentApplication,
    i9Data:                data.i9Data,
    w4Data:                data.w4Data,
    employmentReferences:  data.employmentReferences,
    safetyEducation:       data.safetyEducation,
    signatureData:         data.signatureData,
    acknowledgements:      data.acknowledgements,
    vaccineProofDocuments: Object.fromEntries(
      Object.entries(data.vaccineProofDocuments ?? {}).map(([k, f]) => [k, f ? stripFile(f) : null]),
    ),
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
  if (!f) return null;
  return { ...f, restoredFromCache: true };
}

function fromStorable(stored: StorableFormData): OnboardingFormData {
  return {
    personalInfo:          stored.personalInfo          ?? defaultFormData.personalInfo,
    employmentApplication: stored.employmentApplication  ?? defaultFormData.employmentApplication,
    i9Data:                stored.i9Data                ?? defaultFormData.i9Data,
    w4Data:                stored.w4Data                ?? defaultFormData.w4Data,
    employmentReferences:  stored.employmentReferences  ?? defaultFormData.employmentReferences,
    safetyEducation:       stored.safetyEducation       ?? defaultFormData.safetyEducation,
    signatureData:         stored.signatureData         ?? defaultFormData.signatureData,
    acknowledgements:      stored.acknowledgements      ?? {},
    vaccineProofDocuments: Object.fromEntries(
      Object.entries(stored.vaccineProofDocuments ?? {}).map(([k, f]) => [k, restoreFile(f)]),
    ),
    uploadedDocuments: {
      listA:            restoreFile(stored.uploadedDocuments.listA),
      listB:            restoreFile(stored.uploadedDocuments.listB),
      listC:            restoreFile(stored.uploadedDocuments.listC),
      nursingLicense:   restoreFile(stored.uploadedDocuments.nursingLicense),
      cprCertification: restoreFile(stored.uploadedDocuments.cprCertification),
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function saveOnboardingData(
  data: OnboardingFormData,
  currentStepId: string,
  packetId: string,
  packetVersion: number,
  stepStates: StepStates,
): void {
  try {
    const session: StoredSession = {
      packetId,
      packetVersion,
      currentStepId,
      stepStates,
      formData: toStorable(data),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage unavailable (private browsing, storage full, SSR)
  }
}

export interface RestoredSession {
  formData: OnboardingFormData;
  currentStepId: string;
  packetId: string;
  packetVersion: number;
  stepStates: StepStates;
}

export function loadOnboardingData(): RestoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: StoredSession = JSON.parse(raw);
    return {
      formData:      fromStorable(session.formData),
      currentStepId: session.currentStepId,
      packetId:      session.packetId,
      packetVersion: session.packetVersion ?? 0,
      stepStates:    session.stepStates ?? {},
    };
  } catch {
    return null;
  }
}

export function clearOnboardingData(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
