// ── Personal Info ─────────────────────────────────────────────────────────────
export interface PersonalInfo {
  firstName: string;
  lastName: string;
  middleInitial: string;   // I-9 Section 1
  otherLastNames: string;  // I-9 Section 1 — maiden name, alias, etc.
  dateOfBirth: string;     // I-9 Section 1 — MM/DD/YYYY
  ssn: string;             // optional — required if employer uses E-Verify
  email: string;
  phone: string;
  address: string;
  aptNumber: string;
  city: string;
  state: string;
  zip: string;
}

// ── I-9 (2024) Section 1 ─────────────────────────────────────────────────────
export type CitizenshipStatus =
  | 'citizen'
  | 'noncitizen_national'
  | 'lawful_permanent_resident'
  | 'alien_authorized'
  | '';

export type AlienWorkAuthType = 'arn' | 'i94' | 'passport' | '';

export interface I9Data {
  citizenshipStatus: CitizenshipStatus;
  // Lawful Permanent Resident
  alienRegistrationNumber: string;
  // Alien Authorized to Work
  alienWorkAuthExpiration: string;    // date or "N/A"
  alienWorkAuthType: AlienWorkAuthType;
  alienNumber: string;                // (a) Alien Registration Number / USCIS Number
  i94Number: string;                  // (b) Form I-94 Admission Number
  foreignPassportNumber: string;      // (c) Foreign Passport Number
  foreignPassportCountry: string;     // (c) Country of Issuance
  // Attestation
  attestationAcknowledged: boolean;
}

// ── Employment Reference Check #1 ─────────────────────────────────────────────
// Source: Paramount Care Staffing Employment Reference Check #1 form
// Fields on the applicant section (top half of the form)
export interface EmploymentReference {
  positionHeld: string;             // Position Held
  employmentDateFrom: string;       // Dates of Employment: From
  employmentDateTo: string;         // Dates of Employment: To (or "Present")
  employerName: string;             // Current/Former Employer
  employerCity: string;             // City
  employerState: string;            // State
  supervisorName: string;           // Supervisor's Name
  supervisorPhone: string;          // Tel No.
  permissionGranted: boolean;       // Applicant permission consent
}

// ── Safety & Education ────────────────────────────────────────────────────────
// Source: Paramount Care Staffing Safety & Education Exam (25-question exam)
// Digitized as topic-level acknowledgements for the web onboarding experience
export interface SafetyEducationData {
  patientSafety: boolean;           // Patient Safety & Fall Prevention
  infectionControl: boolean;        // Infection Control & Standard Precautions
  fireSafety: boolean;              // Fire Safety & Emergency Response (RACE/PASS)
  patientRightsHipaa: boolean;      // Patient Rights, Privacy & HIPAA
  workplaceViolence: boolean;       // Workplace Violence & De-escalation
  backSafety: boolean;              // Body Mechanics & Safe Patient Handling
  hazardousMaterials: boolean;      // Hazardous Materials & Bloodborne Pathogens (OSHA)
  documentationStandards: boolean;  // Documentation & Mandatory Reporting
  examAttestation: boolean;         // Final attestation of completion
}

// ── Document Uploads ──────────────────────────────────────────────────────────
export interface UploadedFile {
  name: string;
  size: number;
  type: string;
  file?: File;               // not serializable to localStorage
  restoredFromCache?: boolean;
}

export interface UploadedDocuments {
  // I-9 Employment Eligibility — List A OR (List B + List C)
  listA: UploadedFile | null;       // List A: Passport, Green Card, EAD, etc.
  listB: UploadedFile | null;       // List B: Driver's License, State ID
  listC: UploadedFile | null;       // List C: Social Security Card, Birth Certificate
  // Professional Credentials
  nursingLicense: UploadedFile | null;
  cprCertification: UploadedFile | null;
}

// ── Signature ─────────────────────────────────────────────────────────────────
export interface SignatureData {
  signatureDataUrl: string | null;
  typedName: string;
  signedDate: string;
}

// ── Composite form data ───────────────────────────────────────────────────────
export interface OnboardingFormData {
  personalInfo: PersonalInfo;
  i9Data: I9Data;
  employmentReference: EmploymentReference;
  safetyEducation: SafetyEducationData;
  uploadedDocuments: UploadedDocuments;
  signatureData: SignatureData;
}

// ── Step config ───────────────────────────────────────────────────────────────
export type OnboardingStep =
  | 'personal'
  | 'i9'
  | 'employment'
  | 'safety'
  | 'documents'
  | 'signature'
  | 'review';

export interface StepConfig {
  id: OnboardingStep;
  label: string;
  shortLabel: string;
}

export const STEPS: StepConfig[] = [
  { id: 'personal',    label: 'Personal Info',          shortLabel: 'Personal'   },
  { id: 'i9',          label: 'I-9 Eligibility',        shortLabel: 'I-9'        },
  { id: 'employment',  label: 'Employment Reference',   shortLabel: 'Reference'  },
  { id: 'safety',      label: 'Safety & Education',     shortLabel: 'Safety'     },
  { id: 'documents',   label: 'Documents',              shortLabel: 'Documents'  },
  { id: 'signature',   label: 'Signature',              shortLabel: 'Signature'  },
  { id: 'review',      label: 'Review & Submit',        shortLabel: 'Review'     },
];

// ── Defaults ──────────────────────────────────────────────────────────────────
export const defaultFormData: OnboardingFormData = {
  personalInfo: {
    firstName: '',
    lastName: '',
    middleInitial: '',
    otherLastNames: '',
    dateOfBirth: '',
    ssn: '',
    email: '',
    phone: '',
    address: '',
    aptNumber: '',
    city: '',
    state: '',
    zip: '',
  },
  i9Data: {
    citizenshipStatus: '',
    alienRegistrationNumber: '',
    alienWorkAuthExpiration: '',
    alienWorkAuthType: '',
    alienNumber: '',
    i94Number: '',
    foreignPassportNumber: '',
    foreignPassportCountry: '',
    attestationAcknowledged: false,
  },
  employmentReference: {
    positionHeld: '',
    employmentDateFrom: '',
    employmentDateTo: '',
    employerName: '',
    employerCity: '',
    employerState: '',
    supervisorName: '',
    supervisorPhone: '',
    permissionGranted: false,
  },
  safetyEducation: {
    patientSafety: false,
    infectionControl: false,
    fireSafety: false,
    patientRightsHipaa: false,
    workplaceViolence: false,
    backSafety: false,
    hazardousMaterials: false,
    documentationStandards: false,
    examAttestation: false,
  },
  uploadedDocuments: {
    listA: null,
    listB: null,
    listC: null,
    nursingLicense: null,
    cprCertification: null,
  },
  signatureData: {
    signatureDataUrl: null,
    typedName: '',
    signedDate: '',
  },
};
