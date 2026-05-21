import { z } from 'zod';
import type {
  PersonalInfo,
  I9Data,
  EmploymentReference,
  SafetyEducationData,
  UploadedDocuments,
  SignatureData,
  OnboardingFormData,
  OnboardingStep,
} from '@/types/onboarding';

export type FieldErrors = Record<string, string>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const phoneRegex = /^[\d\s\(\)\-\+\.]{7,}$/;
const zipRegex = /^\d{5}(-\d{4})?$/;

function parseSchema<T>(schema: z.ZodSchema<T>, data: unknown): FieldErrors {
  const result = schema.safeParse(data);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0] ?? '_'), issue.message])
  );
}

// ── Personal Info ─────────────────────────────────────────────────────────────

const personalInfoSchema = z.object({
  firstName:   z.string().min(1, 'First name is required'),
  lastName:    z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required (Form I-9 Section 1)'),
  email:       z.string().min(1, 'Email is required').email('Enter a valid email address'),
  phone:       z.string().min(1, 'Phone is required').regex(phoneRegex, 'Enter a valid phone number'),
  address:     z.string().min(3, 'Street address is required'),
  city:        z.string().min(1, 'City or town is required'),
  state:       z.string().min(2, 'State is required'),
  zip:         z.string().min(1, 'ZIP code is required').regex(zipRegex, 'Enter a 5-digit ZIP code'),
  // Optional fields — no validation needed
  middleInitial: z.string(),
  otherLastNames: z.string(),
  ssn: z.string(),
  aptNumber: z.string(),
});

export function validatePersonalInfo(data: PersonalInfo): FieldErrors {
  return parseSchema(personalInfoSchema, data);
}

// ── I-9 Section 1 ─────────────────────────────────────────────────────────────

export function validateI9(data: I9Data): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.citizenshipStatus) {
    errors.citizenshipStatus = 'Please select your citizenship or immigration status';
    return errors;
  }

  if (data.citizenshipStatus === 'lawful_permanent_resident') {
    if (!data.alienRegistrationNumber.trim()) {
      errors.alienRegistrationNumber = 'Alien Registration Number / USCIS Number is required';
    }
  }

  if (data.citizenshipStatus === 'alien_authorized') {
    if (!data.alienWorkAuthExpiration.trim()) {
      errors.alienWorkAuthExpiration = 'Expiration date is required (enter N/A if not applicable)';
    }
    if (!data.alienWorkAuthType) {
      errors.alienWorkAuthType = 'Select how you will verify your work authorization';
    } else {
      if (data.alienWorkAuthType === 'arn' && !data.alienNumber.trim()) {
        errors.alienNumber = 'Alien Registration Number / USCIS Number is required';
      }
      if (data.alienWorkAuthType === 'i94' && !data.i94Number.trim()) {
        errors.i94Number = 'Form I-94 Admission Number is required';
      }
      if (data.alienWorkAuthType === 'passport') {
        if (!data.foreignPassportNumber.trim()) errors.foreignPassportNumber = 'Foreign Passport Number is required';
        if (!data.foreignPassportCountry.trim()) errors.foreignPassportCountry = 'Country of Issuance is required';
      }
    }
  }

  if (!data.attestationAcknowledged) {
    errors.attestationAcknowledged = 'You must read and acknowledge this statement before continuing';
  }

  return errors;
}

// ── Employment Reference ──────────────────────────────────────────────────────

const employmentReferenceSchema = z.object({
  positionHeld:       z.string().min(1, 'Position held is required'),
  employmentDateFrom: z.string().min(1, 'Employment start date is required'),
  employmentDateTo:   z.string().min(1, 'Employment end date is required'),
  employerName:       z.string().min(1, 'Employer name is required'),
  employerCity:       z.string().min(1, 'City is required'),
  employerState:      z.string().min(2, 'State is required'),
  supervisorName:     z.string().min(1, 'Supervisor name is required'),
  supervisorPhone:    z.string().min(1, 'Supervisor phone is required').regex(phoneRegex, 'Enter a valid phone number'),
  permissionGranted:  z.boolean(),
});

export function validateEmploymentReference(data: EmploymentReference): FieldErrors {
  const errors = parseSchema(employmentReferenceSchema, data);
  if (!data.permissionGranted) {
    errors.permissionGranted = 'You must grant permission before continuing';
  }
  return errors;
}

// ── Safety & Education ────────────────────────────────────────────────────────

export function validateSafety(data: SafetyEducationData): FieldErrors {
  const errors: FieldErrors = {};
  const topics: (keyof Omit<SafetyEducationData, 'examAttestation'>)[] = [
    'patientSafety', 'infectionControl', 'fireSafety', 'patientRightsHipaa',
    'workplaceViolence', 'backSafety', 'hazardousMaterials', 'documentationStandards',
  ];
  const unchecked = topics.filter((k) => !data[k]);
  if (unchecked.length > 0) {
    errors._topics = `${unchecked.length} safety topic${unchecked.length === 1 ? '' : 's'} must be acknowledged before continuing`;
  }
  if (!data.examAttestation) {
    errors.examAttestation = 'Final attestation is required';
  }
  return errors;
}

// ── Documents ─────────────────────────────────────────────────────────────────

export function validateDocuments(_data: UploadedDocuments): FieldErrors {
  return {};
}

// ── Signature ─────────────────────────────────────────────────────────────────

export function validateSignature(data: SignatureData): FieldErrors {
  const errors: FieldErrors = {};
  const hasSig = (data.signatureDataUrl && data.signatureDataUrl.length > 0) || data.typedName.trim().length > 0;
  if (!hasSig) errors.signature = 'Signature is required before submitting';
  return errors;
}

// ── Per-step dispatcher ───────────────────────────────────────────────────────

export function validateStep(step: OnboardingStep, data: OnboardingFormData): FieldErrors {
  switch (step) {
    case 'personal':   return validatePersonalInfo(data.personalInfo);
    case 'i9':         return validateI9(data.i9Data);
    case 'employment': return validateEmploymentReference(data.employmentReference);
    case 'safety':     return validateSafety(data.safetyEducation);
    case 'documents':  return validateDocuments(data.uploadedDocuments);
    case 'signature':  return validateSignature(data.signatureData);
    case 'review':     return {};
  }
}

export function isStepValid(step: OnboardingStep, data: OnboardingFormData): boolean {
  return Object.keys(validateStep(step, data)).length === 0;
}
