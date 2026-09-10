import { z } from 'zod';
import type { PacketStep } from '@pcs/shared';
import type {
  PersonalInfo,
  EmploymentApplicationData,
  I9Data,
  W4Data,
  EmploymentReference,
  SafetyEducationData,
  UploadedDocuments,
  SignatureData,
  AcknowledgementEntry,
  OnboardingFormData,
} from '@/types/onboarding';
import { defaultEmploymentReference } from '@/types/onboarding';

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
  email:       z.string().min(1, 'Email is required').email('Enter a valid email address'),
  phone:       z.string().min(1, 'Phone is required').regex(phoneRegex, 'Enter a valid phone number'),
  address:     z.string().min(3, 'Street address is required'),
  city:        z.string().min(1, 'City or town is required'),
  state:       z.string().min(2, 'State is required'),
  zip:         z.string().min(1, 'ZIP code is required').regex(zipRegex, 'Enter a 5-digit ZIP code'),
  // Optional fields — no validation needed
  middleInitial: z.string(),
  otherLastNames: z.string(),
  aptNumber: z.string(),
});

export function validatePersonalInfo(data: PersonalInfo): FieldErrors {
  return parseSchema(personalInfoSchema, data);
}

// ── Employment Application ────────────────────────────────────────────────────

export function validateEmploymentApplication(data: EmploymentApplicationData): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.positionApplied.trim())   errors.positionApplied   = 'Position applied for is required';
  if (!data.specialtyPreference.trim()) errors.specialtyPreference = 'Specialty / unit preference is required';
  if (!data.shiftPreference)          errors.shiftPreference   = 'Shift preference is required';
  if (!data.employmentType)           errors.employmentType    = 'Employment type is required';

  if (!data.licenseType)              errors.licenseType       = 'License type is required';
  if (!data.licenseNumber.trim())     errors.licenseNumber     = 'License number is required';
  if (!data.licenseState)             errors.licenseState      = 'License state is required';
  if (!data.licenseExpiration.trim()) errors.licenseExpiration = 'License expiration date is required';

  if (!data.yearsExperience)          errors.yearsExperience   = 'Years of experience is required';
  if (!data.primarySpecialty.trim())  errors.primarySpecialty  = 'Primary specialty is required';

  if (data.authorizedToWork !== true) {
    errors.authorizedToWork = 'You must be legally authorized to work in the United States to proceed';
  }

  if (data.hasConviction === null) {
    errors.hasConviction = 'Please answer the felony conviction question';
  } else if (data.hasConviction && !data.convictionDetails.trim()) {
    errors.convictionDetails = 'Please provide details regarding your conviction';
  }

  if (data.hasLicenseDiscipline === null) {
    errors.hasLicenseDiscipline = 'Please answer the license discipline question';
  } else if (data.hasLicenseDiscipline && !data.licenseDisciplineDetails.trim()) {
    errors.licenseDisciplineDetails = 'Please provide details regarding the disciplinary action';
  }

  if (data.hasLicenseRevocation === null) {
    errors.hasLicenseRevocation = 'Please answer the license revocation/suspension question';
  } else if (data.hasLicenseRevocation && !data.licenseRevocationDetails.trim()) {
    errors.licenseRevocationDetails = 'Please provide details regarding the license action';
  }

  if (data.underInvestigation === null) {
    errors.underInvestigation = 'Please answer the board investigation question';
  }

  if (!data.emergencyContactName.trim())         errors.emergencyContactName         = 'Emergency contact name is required';
  if (!data.emergencyContactRelationship.trim())  errors.emergencyContactRelationship  = 'Relationship is required';
  if (!data.emergencyContactPhone.trim())         errors.emergencyContactPhone         = 'Emergency contact phone is required';
  else if (!phoneRegex.test(data.emergencyContactPhone)) errors.emergencyContactPhone = 'Enter a valid phone number';

  return errors;
}

// ── I-9 Section 1 ─────────────────────────────────────────────────────────────

export function validateI9(data: I9Data): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.dateOfBirth.trim()) {
    errors.dateOfBirth = 'Date of birth is required for Form I-9 Section 1';
  }

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

  const hasSignature =
    (data.i9SignatureType === 'drawn' && !!data.i9SignatureDataUrl) ||
    (data.i9SignatureType === 'typed' && !!data.i9TypedSignature.trim());

  if (!hasSignature) {
    errors.i9Signature = 'Signature is required — sign or type your name to complete the I-9 attestation';
  }

  if (!data.i9SignedDate) {
    errors.i9SignedDate = 'Signed date is required';
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
  reasonForLeaving:   z.string().min(1, 'Reason for leaving is required'),
  eligibleForRehire:  z.union([z.boolean(), z.null()]),
  rehireDetails:      z.string(),
  comments:           z.string(),
});

export function validateEmploymentReference(data: EmploymentReference): FieldErrors {
  const errors = parseSchema(employmentReferenceSchema, data);
  if (!data.permissionGranted) {
    errors.permissionGranted = 'You must grant permission before continuing';
  }
  if (data.eligibleForRehire === null) {
    errors.eligibleForRehire = 'Please indicate rehire eligibility';
  } else if (data.eligibleForRehire === false && !data.rehireDetails.trim()) {
    errors.rehireDetails = 'Please explain why you were not eligible for rehire';
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

// ── IRS W-4 ───────────────────────────────────────────────────────────────────

export function validateW4(data: W4Data): FieldErrors {
  const errors: FieldErrors = {};
  if (!data.firstNameMI.trim()) errors.firstNameMI = 'First name is required';
  if (!data.lastName.trim())   errors.lastName    = 'Last name is required';
  if (!data.ssn.trim())        errors.ssn         = 'Social security number is required';
  if (!data.address.trim())    errors.address     = 'Address is required';
  if (!data.cityStateZip.trim()) errors.cityStateZip = 'City, state, and ZIP code are required';
  if (!data.filingStatus)      errors.filingStatus = 'Please select your filing status';
  if (!data.typedSignature.trim()) errors.typedSignature = 'Your signature is required to certify the W-4';
  if (!data.signedDate.trim()) errors.signedDate  = 'Date is required';
  return errors;
}

// ── Vaccine Declination ───────────────────────────────────────────────────────

export function validateVaccineDeclination(
  entry: AcknowledgementEntry | undefined,
  requiresSignature: boolean,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!entry?.decision) {
    errors.decision = 'Please select whether you are declining or providing proof of vaccination';
    return errors;
  }

  if (entry.decision === 'declining') {
    if (!entry.checked) {
      errors.checked = 'You must read and acknowledge the declination statement before continuing';
    }
    if (requiresSignature && !entry.typedSignature?.trim()) {
      errors.typedSignature = 'Your electronic signature is required to complete the declination';
    }
  }

  return errors;
}

// ── Acknowledgement ───────────────────────────────────────────────────────────

export function validateAcknowledgement(
  entry: AcknowledgementEntry | undefined,
  requiresSignature: boolean,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!entry?.checked) {
    errors.checked = 'You must acknowledge this item before continuing';
  }
  if (requiresSignature && !entry?.typedSignature?.trim()) {
    errors.typedSignature = 'Your typed signature is required';
  }
  return errors;
}

// ── Per-step dispatcher ───────────────────────────────────────────────────────
//
// Dispatches by step.type (and step.subtype where needed).
// The optional `step` parameter enables type-based dispatch; when omitted
// the function falls back to legacy step-ID dispatch for callers that haven't
// migrated yet.

export function validateStep(
  stepId: string,
  data: OnboardingFormData,
  step?: PacketStep,
): FieldErrors {
  // Type-based dispatch (preferred path — used when PacketStep is available)
  if (step) {
    switch (step.type) {
      case 'personal_info':
        return validatePersonalInfo(data.personalInfo);

      case 'government_form':
        if (step.subtype === 'i9') return validateI9(data.i9Data);
        if (step.subtype === 'w4') return validateW4(data.w4Data);
        return validateAcknowledgement(
          data.acknowledgements[step.id],
          step.config?.requiresSignature ?? true,
        );

      case 'internal_form':
        if (step.subtype === 'employment_application') {
          return validateEmploymentApplication(data.employmentApplication);
        }
        return validateAcknowledgement(
          data.acknowledgements[step.id],
          step.config?.requiresSignature ?? true,
        );

      case 'acknowledgement':
        if (step.config?.hasDeclination) {
          return validateVaccineDeclination(
            data.acknowledgements[step.id],
            step.config?.requiresSignature ?? true,
          );
        }
        if (step.config?.acknowledgementId === 'safety_acknowledgements') {
          return validateSafety(data.safetyEducation);
        }
        return validateAcknowledgement(
          data.acknowledgements[step.id],
          step.config?.requiresSignature ?? false,
        );

      case 'employment_reference':
        return validateEmploymentReference(data.employmentReferences?.[step.id] ?? defaultEmploymentReference);

      case 'document_upload':
        return validateDocuments(data.uploadedDocuments);

      case 'exam':
      case 'review':
        return {};

      default:
        return {};
    }
  }

  // Legacy ID-based dispatch (fallback for callers without PacketStep)
  switch (stepId) {
    case 'personal_info':    return validatePersonalInfo(data.personalInfo);
    case 'w4':               return validateW4(data.w4Data);
    case 'i9':               return validateI9(data.i9Data);
    case 'employment_ref_1':
    case 'employment_ref_2':
    case 'employment_ref_3': return validateEmploymentReference(data.employmentReferences?.[stepId] ?? defaultEmploymentReference);
    case 'hep_b_declination':
    case 'tdap_declination':
    case 'flu_declination':  return validateVaccineDeclination(data.acknowledgements[stepId], true);
    case 'safety_acknowledgements': return validateSafety(data.safetyEducation);
    case 'documents':        return validateDocuments(data.uploadedDocuments);
    case 'review':           return {};
    default:                 return {};
  }
}

export function isStepValid(stepId: string, data: OnboardingFormData, step?: PacketStep): boolean {
  return Object.keys(validateStep(stepId, data, step)).length === 0;
}
