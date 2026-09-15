// ── Personal Info ─────────────────────────────────────────────────────────────
export interface PersonalInfo {
  firstName: string;
  lastName: string;
  middleInitial: string;   // I-9 Section 1
  otherLastNames: string;  // I-9 Section 1 — maiden name, alias, etc.
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

export type I9SignatureType = 'drawn' | 'typed' | '';

export interface I9Data {
  // Section 1 personal identity — entered directly in the I-9 (seeded from personal info step)
  firstName: string;
  lastName: string;
  middleInitial: string;
  otherLastNames: string;
  address: string;
  aptNumber: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  phone: string;
  // Identity verification fields
  dateOfBirth: string;                // MM/DD/YYYY — required for I-9 Section 1
  ssn: string;                        // optional — required if employer uses E-Verify
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
  // Inline signature — the employee signs directly within the I-9 step.
  // Signing IS the attestation; no separate checkbox needed.
  i9SignatureDataUrl: string;         // base64 PNG data URL (drawn) or empty string
  i9SignatureType: I9SignatureType;
  i9TypedSignature: string;           // full legal name when type mode is used
  i9SignedDate: string;               // MM/DD/YYYY — auto-set when signature is captured
}

// ── Employment Application ────────────────────────────────────────────────────
// Source: Paramount Care Staffing Application for Employment
export interface EmploymentApplicationData {
  // Position applied for
  positionApplied: string;         // RN, LVN, CNA, NP, etc.
  specialtyPreference: string;     // ICU, ER, Med-Surg, L&D, Peds, etc.
  shiftPreference: string;         // 'day' | 'evening' | 'night' | 'any'
  employmentType: string;          // 'full_time' | 'part_time' | 'per_diem'
  availableStartDate: string;      // YYYY-MM-DD

  // Professional license / credentials
  licenseType: string;             // 'RN' | 'LVN' | 'NP' | 'CNA' | 'other'
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;       // YYYY-MM-DD (HTML date input)
  hasCPR: boolean;
  cprCertNumber: string;
  cprExpiration: string;           // YYYY-MM-DD

  // Clinical experience summary
  yearsExperience: string;         // '0-1' | '1-3' | '3-5' | '5-10' | '10+'
  primarySpecialty: string;        // free text — main clinical specialty
  currentlyEmployed: boolean | null;
  previouslyWorkedHere: boolean | null;  // previously with Paramount Care Staffing

  // Eligibility & background questions
  authorizedToWork: boolean | null;      // must be true to proceed
  hasConviction: boolean | null;
  convictionDetails: string;
  hasLicenseDiscipline: boolean | null;
  licenseDisciplineDetails: string;
  hasLicenseRevocation: boolean | null; // limited, suspended, revoked, or voluntarily relinquished
  licenseRevocationDetails: string;
  licenseRevocationJurisdiction: string; // state(s) where action occurred — optional
  licenseRevocationDate: string;         // approximate date — optional, YYYY-MM-DD
  underInvestigation: boolean | null;

  // Emergency contact
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
}

// ── Employment Reference Check ────────────────────────────────────────────────
// Source: Paramount Care Staffing Employment Reference Check forms
// One instance per step ID (e.g. 'employment_ref_1', 'employment_ref_2').
export interface EmploymentReference {
  positionHeld: string;                // Position Held
  employmentDateFrom: string;          // Dates of Employment: From
  employmentDateTo: string;            // Dates of Employment: To (or "Present")
  employerName: string;                // Current/Former Employer
  employerCity: string;                // City
  employerState: string;               // State
  supervisorName: string;              // Supervisor's Name
  supervisorPhone: string;             // Tel No.
  permissionGranted: boolean;          // Applicant permission consent
  reasonForLeaving: string;            // Reason for leaving this employer
  eligibleForRehire: boolean | null;   // Were you eligible for rehire?
  rehireDetails: string;               // Required if eligibleForRehire === false
  comments: string;                    // Additional comments / notes (optional)
}

export const defaultEmploymentReference: EmploymentReference = {
  positionHeld: '',
  employmentDateFrom: '',
  employmentDateTo: '',
  employerName: '',
  employerCity: '',
  employerState: '',
  supervisorName: '',
  supervisorPhone: '',
  permissionGranted: false,
  reasonForLeaving: '',
  eligibleForRehire: null,
  rehireDetails: '',
  comments: '',
};

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
  objectKey?: string;        // R2 object key, set after successful upload
  uploadedAt?: string;       // ISO timestamp from the Worker, set after successful upload
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

// ── IRS W-4 (2024) ────────────────────────────────────────────────────────────
// Employee's Withholding Certificate — employee-filled sections only.
// Employer sections (name/address, EIN, first date of employment) are
// completed by Paramount Care Staffing and are NOT collected here.
export type W4FilingStatus = 'single_mfs' | 'mfj_qss' | 'hoh' | '';

export interface W4Data {
  // Step 1 — Personal Information
  firstNameMI: string;     // First name and middle initial (1a)
  lastName: string;        // Last name (1b)
  ssn: string;             // Social security number
  address: string;         // Home address (number and street or rural route)
  cityStateZip: string;    // City or town, state, and ZIP code
  filingStatus: W4FilingStatus;  // Step 1(c) checkbox selection

  // Step 2 — Multiple Jobs or Spouse Works (optional)
  multipleJobs: boolean;   // Box 2(c): checked when this step applies

  // Step 3 — Claim Dependents (optional, dollar amounts)
  qualifyingChildren: string;  // $ — qualifying children under 17 × $2,000
  otherDependents: string;     // $ — other dependents × $500
  totalDependents: string;     // $ — add the amounts above

  // Step 4 — Other Adjustments (optional, dollar amounts)
  otherIncome: string;         // 4(a) — other income not from jobs
  deductions: string;          // 4(b) — deductions (if exceeding standard deduction)
  extraWithholding: string;    // 4(c) — extra withholding each pay period

  // Step 5 — Sign Here
  typedSignature: string;      // Employee's electronic typed signature
  signedDate: string;          // MM/DD/YYYY — auto-set when signature is entered
}

export const defaultW4Data: W4Data = {
  firstNameMI: '',
  lastName: '',
  ssn: '',
  address: '',
  cityStateZip: '',
  filingStatus: '',
  multipleJobs: false,
  qualifyingChildren: '',
  otherDependents: '',
  totalDependents: '',
  otherIncome: '',
  deductions: '',
  extraWithholding: '',
  typedSignature: '',
  signedDate: '',
};

// ── Direct Deposit Authorization ────────────────────────────────────────────
// Source: Paramount Care Staffing "Business Payroll Services — Direct
// Deposit Authorization" form (Wells Fargo BPS-OP-CDDA-041709 template),
// page 17 of the Paramount onboarding/DocuSign packet. Every field below
// exists on that form; the routing-number format is the ONLY validation
// rule the source states (9 digits, must begin with 0, 1, 2, or 3 — no ABA
// checksum). A second bank account ("4. Additional Bank Information") is
// explicitly supported by the source form as an optional split deposit.
export type BankAccountType = 'checking' | 'savings' | '';
export type DepositAllocationType = 'percentage' | 'dollar' | '';

export interface DirectDepositBankAccount {
  bankName: string;
  accountType: BankAccountType;
  routingNumber: string;         // 9 digits, must begin with 0/1/2/3
  accountNumber: string;
  depositType: DepositAllocationType;
  depositAmount: string;         // percentage (e.g. "100") or dollar amount, depending on depositType
}

export const defaultDirectDepositBankAccount: DirectDepositBankAccount = {
  bankName: '',
  accountType: '',
  routingNumber: '',
  accountNumber: '',
  depositType: '',
  depositAmount: '',
};

export interface DirectDepositData {
  // "2. Employee Information" — prefillable from Personal Info
  lastName: string;
  firstName: string;
  middleInitial: string;
  employeeId: string;            // Employee Identification Number — employer/HR-assigned, optional

  // "3. Bank Information" — primary account, required
  primaryAccount: DirectDepositBankAccount;
  // "4. Additional Bank Information" — second account, optional split deposit
  additionalAccount: DirectDepositBankAccount;

  // "5. Authorization Agreement For Direct Deposit"
  typedSignature: string;
  signedDate: string;
}

export const defaultDirectDepositData: DirectDepositData = {
  lastName: '',
  firstName: '',
  middleInitial: '',
  employeeId: '',
  primaryAccount: { ...defaultDirectDepositBankAccount },
  additionalAccount: { ...defaultDirectDepositBankAccount },
  typedSignature: '',
  signedDate: '',
};

// ── Signature ─────────────────────────────────────────────────────────────────
export interface SignatureData {
  signatureDataUrl: string | null;
  typedName: string;
  signedDate: string;
}

// ── Acknowledgement entries (one per acknowledgement/gov_form step) ───────────
export interface AcknowledgementEntry {
  checked: boolean;
  typedSignature: string;    // full legal name — required when step.config.requiresSignature
  signedAt: string;          // ISO timestamp — set when signature is captured
  // Vaccine declination steps only (when step.config.hasDeclination === true)
  decision?: 'declining' | 'providing_proof' | null;
}

// ── Composite form data ───────────────────────────────────────────────────────
export interface OnboardingFormData {
  personalInfo: PersonalInfo;
  employmentApplication: EmploymentApplicationData;
  i9Data: I9Data;
  w4Data: W4Data;
  /** Keyed by step ID (e.g. 'employment_ref_1', 'employment_ref_2'). */
  employmentReferences: Record<string, EmploymentReference>;
  safetyEducation: SafetyEducationData;
  uploadedDocuments: UploadedDocuments;
  signatureData: SignatureData;
  /** Keyed by step ID — covers all acknowledgement, government_form, and internal_form steps. */
  acknowledgements: Record<string, AcknowledgementEntry>;
  /** Vaccination proof uploads — keyed by vaccine step ID (e.g. 'hep_b_declination'). */
  vaccineProofDocuments: Record<string, UploadedFile | null>;
  directDepositData: DirectDepositData;
  /** Voided-check proof required by the Direct Deposit Authorization source form. */
  directDepositProofDocument: UploadedFile | null;
}

// ── Step identifier ───────────────────────────────────────────────────────────
// Deprecated: renderer now dispatches on step.type + step.subtype from PacketStep.
// Retained only for any legacy code that hasn't migrated; do not add new values.
/** @deprecated Use PacketStep.type and PacketStep.subtype for dispatch. */
export type OnboardingStep = string;

// ── Defaults ──────────────────────────────────────────────────────────────────
export const defaultFormData: OnboardingFormData = {
  personalInfo: {
    firstName: '',
    lastName: '',
    middleInitial: '',
    otherLastNames: '',
    email: '',
    phone: '',
    address: '',
    aptNumber: '',
    city: '',
    state: '',
    zip: '',
  },
  employmentApplication: {
    positionApplied: '',
    specialtyPreference: '',
    shiftPreference: '',
    employmentType: '',
    availableStartDate: '',
    licenseType: '',
    licenseNumber: '',
    licenseState: '',
    licenseExpiration: '',
    hasCPR: false,
    cprCertNumber: '',
    cprExpiration: '',
    yearsExperience: '',
    primarySpecialty: '',
    currentlyEmployed: null,
    previouslyWorkedHere: null,
    authorizedToWork: null,
    hasConviction: null,
    convictionDetails: '',
    hasLicenseDiscipline: null,
    licenseDisciplineDetails: '',
    hasLicenseRevocation: null,
    licenseRevocationDetails: '',
    licenseRevocationJurisdiction: '',
    licenseRevocationDate: '',
    underInvestigation: null,
    emergencyContactName: '',
    emergencyContactRelationship: '',
    emergencyContactPhone: '',
  },
  i9Data: {
    firstName: '',
    lastName: '',
    middleInitial: '',
    otherLastNames: '',
    address: '',
    aptNumber: '',
    city: '',
    state: '',
    zip: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    ssn: '',
    citizenshipStatus: '',
    alienRegistrationNumber: '',
    alienWorkAuthExpiration: '',
    alienWorkAuthType: '',
    alienNumber: '',
    i94Number: '',
    foreignPassportNumber: '',
    foreignPassportCountry: '',
    i9SignatureDataUrl: '',
    i9SignatureType: '',
    i9TypedSignature: '',
    i9SignedDate: '',
  },
  w4Data: defaultW4Data,
  employmentReferences: {},
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
  acknowledgements: {},
  vaccineProofDocuments: {},
  directDepositData: defaultDirectDepositData,
  directDepositProofDocument: null,
};
