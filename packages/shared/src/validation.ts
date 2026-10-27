import { z } from 'zod';
import type { PacketStep } from './packets';
import type {
  PersonalInfo,
  EmploymentApplicationData,
  I9Data,
  W4Data,
  EmploymentReference,
  SafetyEducationData,
  UploadedDocuments,
  UploadedFile,
  SignatureData,
  AcknowledgementEntry,
  OnboardingFormData,
  DirectDepositData,
  DirectDepositBankAccount,
} from './onboarding';
import { defaultEmploymentReference } from './onboarding';
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
import { ageOnDate, isValidIsoDate, isoDateOf } from './dates';

export type FieldErrors = Record<string, string>;

/** Applicants must be at least this old (Personal Information's DOB). */
export const MINIMUM_AGE_YEARS = 18;

// ── Helpers ──────────────────────────────────────────────────────────────────

// A US phone number — this app is US-only (see zipRegex below and the
// US-only state dropdown throughout every screen that collects an address),
// so a 10-digit NANP number is the correct rule, not an invented policy.
// The PREVIOUS version of this regex (`/^[\d\s\(\)\-\+\.]{7,}$/`) only
// checked character class + a minimum length of 7 — it never actually
// counted digits, so a 7/8/9-digit number was unconditionally accepted,
// and even a 6-digit number became "valid" the instant any 7th allowed
// character (e.g. a single stray trailing space from the keyboard) was
// present. Structured to require exactly 3+3+4 digits, with optional
// parens/space/dash/dot separators in the conventional positions — matches
// every format already used across this app's own screens/tests/fixtures
// (5551234567, 555-123-4567, (555) 123-4567, 555 123 4567). No +1/country
// code support is added — nothing in the existing source establishes that.
const phoneRegex = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;
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
  phone:       z.string().min(1, 'Phone is required').regex(phoneRegex, 'Enter a valid 10-digit phone number.'),
  address:     z.string().min(3, 'Street address is required'),
  city:        z.string().min(1, 'City or town is required'),
  state:       z.string().min(2, 'State is required'),
  zip:         z.string().min(1, 'ZIP code is required').regex(zipRegex, 'Enter a 5-digit ZIP code'),
  // Checked separately (validatePersonalInfo) — needs a calendar-age rule.
  dateOfBirth: z.string().optional(),
  // Optional fields — no validation needed
  middleInitial: z.string(),
  otherLastNames: z.string(),
  aptNumber: z.string(),
});

/** Date of birth is required and the applicant must be at least 18 on
 * `asOf` (a real calendar-age calculation — see dates.ts ageOnDate). Pass
 * `asOf` only to make the age check deterministic (tests); everything else
 * uses today. Same rule mobile, completion, and the Worker apply. */
export function validatePersonalInfo(data: PersonalInfo, asOf: Date = new Date()): FieldErrors {
  const errors = parseSchema(personalInfoSchema, data);
  const dob = (data.dateOfBirth ?? '').trim();
  if (!dob) {
    errors.dateOfBirth = 'Date of birth is required';
  } else if (!isValidIsoDate(dob)) {
    errors.dateOfBirth = 'Enter a valid date (MM/DD/YYYY)';
  } else {
    const age = ageOnDate(dob, isoDateOf(asOf));
    if (age === null) errors.dateOfBirth = 'Enter a valid date of birth';
    else if (age < MINIMUM_AGE_YEARS) errors.dateOfBirth = `You must be at least ${MINIMUM_AGE_YEARS} years old to apply.`;
  }
  return errors;
}

// ── Employment Application ────────────────────────────────────────────────────

//
// UAT feedback: position / employment type / primary specialty are fixed
// choices, unit and shift preferences are multi-selects, and the unit
// preference is not asked of (nor required for) a CNA. Input is normalized
// first (employmentApplication.ts), so a session saved before these changes
// — string unit/shift values, missing new keys — can never crash this; a
// legacy value that isn't an allowed choice is simply reported invalid.
// Hidden CNA unit selections are ignored here, never required to be cleared.
// Resume-first onboarding: experience/work-history fields (years of
// experience, primary specialty, …) are covered by the resume and are not
// validated at all — a legacy value is neither required nor rejected.
export function validateEmploymentApplication(raw: EmploymentApplicationData): FieldErrors {
  const errors: FieldErrors = {};
  const data = normalizeEmploymentApplication(raw);

  if (!data.positionApplied.trim()) {
    errors.positionApplied = 'Position applied for is required';
  } else if (!isOptionValue(POSITION_OPTIONS, data.positionApplied)) {
    errors.positionApplied = 'Select CNA, Tech, LVN, RN, or NP';
  }

  // Only the selections valid for the chosen position count (a CNA is
  // always [CNA]); selections left over from another position are drafts.
  if (requiresUnitPreference(data.positionApplied) && isOptionValue(POSITION_OPTIONS, data.positionApplied)) {
    if (activeSpecialtySelections(data.positionApplied, data.specialtyPreference).length === 0) {
      errors.specialtyPreference = 'Select at least one specialty / unit preference';
    }
  }

  if (data.shiftPreference.length === 0) {
    errors.shiftPreference = 'Select at least one shift preference';
  } else if (!data.shiftPreference.every((v) => isOptionValue(SHIFT_PREFERENCE_OPTIONS, v))) {
    errors.shiftPreference = 'Shift preference contains an option that is no longer available';
  }

  if (data.employmentType.length === 0) {
    errors.employmentType = 'Select at least one employment type';
  } else if (!data.employmentType.every((v) => isOptionValue(EMPLOYMENT_TYPE_OPTIONS, v))) {
    errors.employmentType = 'Select Per-Diem Assignment, Travel Assignment, or both';
  }

  if (!data.licenseType)              errors.licenseType       = 'License type is required';
  else if (!isOptionValue(LICENSE_TYPE_OPTIONS, data.licenseType)) errors.licenseType = 'Select CNA, Tech, LVN, RN, or NP';
  if (!data.licenseNumber.trim())     errors.licenseNumber     = 'License number is required';
  if (!data.licenseState)             errors.licenseState      = 'License state is required';
  if (!data.licenseExpiration.trim()) {
    errors.licenseExpiration = 'License expiration date is required';
  } else if (!isValidIsoDate(data.licenseExpiration)) {
    errors.licenseExpiration = 'Enter a valid date (MM-DD-YYYY)';
  }

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

  if (data.availableStartDate.trim() && !isValidIsoDate(data.availableStartDate)) {
    errors.availableStartDate = 'Enter a valid date (MM/DD/YYYY)';
  }

  if (data.hasLicenseRevocation === null) {
    errors.hasLicenseRevocation = 'Please answer the license revocation/suspension question';
  } else if (data.hasLicenseRevocation && !data.licenseRevocationDetails.trim()) {
    errors.licenseRevocationDetails = 'Please provide details regarding the license action';
  }
  if (data.hasLicenseRevocation && data.licenseRevocationDate.trim() && !isValidIsoDate(data.licenseRevocationDate)) {
    errors.licenseRevocationDate = 'Enter a valid date (MM/DD/YYYY)';
  }

  if (data.underInvestigation === null) {
    errors.underInvestigation = 'Please answer the board investigation question';
  }

  if (!data.emergencyContactName.trim())         errors.emergencyContactName         = 'Emergency contact name is required';
  if (!data.emergencyContactRelationship.trim())  errors.emergencyContactRelationship  = 'Relationship is required';
  if (!data.emergencyContactPhone.trim())         errors.emergencyContactPhone         = 'Emergency contact phone is required';
  else if (!phoneRegex.test(data.emergencyContactPhone)) errors.emergencyContactPhone = 'Enter a valid 10-digit phone number.';

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const employmentReferenceSchema = z.object({
  supervisorName:     z.string().min(1, 'Supervisor name is required'),
  supervisorTitle:    z.string().trim().min(1, 'Supervisor title is required'),
  employerName:       z.string().min(1, 'Facility or employer is required'),
  supervisorPhone:    z.string().min(1, 'Supervisor phone is required').regex(phoneRegex, 'Enter a valid 10-digit phone number.'),
  permissionGranted:  z.boolean(),
});

// Same rules for every reference step (#1, #2, optional #3) — they share one
// type, one screen, and one formData record. Resume-first onboarding: only
// who to contact and permission to contact them are required; the
// employment details themselves are on the resume. Legacy fields (position
// held, dates, employer city/state, rehire eligibility, reason for leaving)
// are never required and old values are passed through untouched. Every
// rule here was already enforced before resume-first (only supervisorEmail
// is new, and optional), so a reference completed under the old rules can
// never become invalid.
export function validateEmploymentReference(raw: EmploymentReference): FieldErrors {
  // Defaults first: a reference saved before a field existed gets a
  // friendly "required" message, not a type error.
  const data: EmploymentReference = { ...defaultEmploymentReference, ...raw };
  const errors = parseSchema(employmentReferenceSchema, data);
  const email = (data.supervisorEmail ?? '').trim();
  if (email && !emailRegex.test(email)) {
    errors.supervisorEmail = 'Enter a valid email address, or leave it blank';
  }
  if (!data.permissionGranted) {
    errors.permissionGranted = 'You must grant permission before continuing';
  }
  return errors;
}

// ── Resume ────────────────────────────────────────────────────────────────────
//
// The whole "About You & Work History" phase. Like every other document
// field, `resumeDocument` is only ever set by the Worker's ownership-verified
// association route; final submission additionally re-checks the upload
// ledger itself (worker/src/services/submission.ts), so a value written any
// other way can never stand in for a real uploaded resume.
export function validateResume(file: UploadedFile | null | undefined): FieldErrors {
  return file ? {} : { resumeDocument: 'Upload your resume to continue.' };
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
//
// M14: this was previously a no-op stub — a `document_upload` step could be
// marked "completed" with zero uploads. Sourced directly from the step's
// own config (`packets.ts`'s `i9Uploads`/`requiredUploads` — identical
// across every packet today, confirmed by reading the actual definitions,
// not assumed), never a hardcoded list, so a future packet with a
// different document set is a config change here, not a code change.
// `UploadedFile` values in `formData.uploadedDocuments` only ever arrive
// via the ownership-verified session-association endpoint (M13/M13
// hardening) — a locally-picked-but-not-yet-uploaded, failed, or orphaned
// file structurally can never appear here, so no separate "is this really
// associated" check is needed beyond "is the field non-null."

const REQUIRED_UPLOAD_FIELD: Record<string, { field: keyof UploadedDocuments; label: string }> = {
  nursing_license: { field: 'nursingLicense', label: 'your professional license or certification' },
  cpr_cert:        { field: 'cprCertification', label: 'your CPR/BLS certification' },
};

export function validateDocuments(data: UploadedDocuments, step?: PacketStep): FieldErrors {
  const errors: FieldErrors = {};
  const config = step?.config;

  if (config?.i9Uploads) {
    const hasListA = !!data.listA;
    const hasListBAndC = !!data.listB && !!data.listC;
    if (!hasListA && !hasListBAndC) {
      errors.i9 = 'Upload a List A document, or both a List B and a List C document, to verify your identity and work authorization.';
    }
  }

  for (const key of config?.requiredUploads ?? []) {
    const entry = REQUIRED_UPLOAD_FIELD[key];
    if (!entry) continue; // an unrecognized config key never invents a slot to require
    if (!data[entry.field]) {
      errors[entry.field] = `Upload ${entry.label} to continue.`;
    }
  }

  return errors;
}

// ── Signature ─────────────────────────────────────────────────────────────────

export function validateSignature(data: SignatureData): FieldErrors {
  const errors: FieldErrors = {};
  const hasSig = (data.signatureDataUrl && data.signatureDataUrl.length > 0) || data.typedName.trim().length > 0;
  if (!hasSig) errors.signature = 'Signature is required before submitting';
  return errors;
}

// ── IRS W-4 ───────────────────────────────────────────────────────────────────
//
// Exempt-from-withholding handling (2026 form, W-4 template/version
// follow-up): the form's own instructions say that to claim exemption, an
// employee certifies both IRS conditions via the exemptFromWithholding
// checkbox, then completes ONLY Steps 1(a), 1(b), and 5 — filingStatus
// (Step 1(c)) is explicitly excluded from that list, so it is not required
// here when exempt. Steps 2-4 were never required by this validator either
// way (they're genuinely optional on the real form for every filer, exempt
// or not), so exemptFromWithholding does not need to touch them. This
// deliberately does NOT clear filingStatus or any Step 2-4 value when
// exemptFromWithholding is toggled — matching this codebase's existing rule
// for a field hidden/de-required by a conditional (see
// useEmploymentApplicationForm.ts's own doc comment: a value is saved as
// entered and never silently cleared just because its condition changed),
// rather than the I9Screen citizenship-branch pattern of clearing a
// no-longer-relevant field on switch — that pattern exists for I-9 branches
// that are mutually exclusive identity claims, not for an optional
// dollar-amount step whose values remain harmless (and instantly usable
// again) if exemption is unchecked later.
export function validateW4(data: W4Data): FieldErrors {
  const errors: FieldErrors = {};
  if (!data.firstNameMI.trim()) errors.firstNameMI = 'First name is required';
  if (!data.lastName.trim())   errors.lastName    = 'Last name is required';
  if (!data.ssn.trim())        errors.ssn         = 'Social security number is required';
  if (!data.address.trim())    errors.address     = 'Address is required';
  if (!data.cityStateZip.trim()) errors.cityStateZip = 'City, state, and ZIP code are required';
  if (!data.exemptFromWithholding && !data.filingStatus) {
    errors.filingStatus = 'Please select your filing status';
  }
  if (!data.typedSignature.trim()) errors.typedSignature = 'Your signature is required to certify the W-4';
  if (!data.signedDate.trim()) errors.signedDate  = 'Date is required';
  return errors;
}

// ── Direct Deposit ────────────────────────────────────────────────────────────
//
// Source: Paramount "Business Payroll Services — Direct Deposit
// Authorization" form (see onboarding.ts's DirectDepositData doc comment).
// The routing-number regex is the ONLY explicit validation rule the source
// states (9 digits, must begin with 0/1/2/3) — no ABA checksum is invented.
// The primary account and a signed authorization are required; the second
// ("Additional Bank Information") account is optional, but if the applicant
// has started filling it in, it must be completed like the primary one
// rather than left half-entered. Bank account verification is required by
// the source form's own text ("Attach a voided check with this agreement");
// per UAT feedback the business intent is verifying the account, so a
// voided check OR another bank document / banking-app screenshot showing
// the routing and account numbers satisfies it — the requirement itself
// (one uploaded, ownership-verified document) is unchanged.

const routingNumberRegex = /^[0-3]\d{8}$/;

function isBankAccountStarted(account: DirectDepositBankAccount): boolean {
  return !!(
    account.bankName.trim() ||
    account.accountType ||
    account.routingNumber.trim() ||
    account.accountNumber.trim() ||
    account.depositType ||
    account.depositAmount.trim()
  );
}

function validateBankAccount(account: DirectDepositBankAccount, prefix: 'primary' | 'additional'): FieldErrors {
  const errors: FieldErrors = {};
  if (!account.bankName.trim()) errors[`${prefix}BankName`] = 'Bank name is required';
  if (!account.accountType) errors[`${prefix}AccountType`] = 'Please select an account type';

  if (!account.routingNumber.trim()) {
    errors[`${prefix}RoutingNumber`] = 'Routing/transit number is required';
  } else if (!routingNumberRegex.test(account.routingNumber.trim())) {
    errors[`${prefix}RoutingNumber`] = 'Routing number must be 9 digits and begin with 0, 1, 2, or 3';
  }

  if (!account.accountNumber.trim()) errors[`${prefix}AccountNumber`] = 'Account number is required';

  if (!account.depositType) {
    errors[`${prefix}DepositType`] = 'Please select percentage or dollar amount';
  } else if (!account.depositAmount.trim()) {
    errors[`${prefix}DepositAmount`] = account.depositType === 'percentage'
      ? 'Please specify a percentage'
      : 'Please specify a dollar amount';
  } else {
    const value = Number(account.depositAmount);
    if (Number.isNaN(value) || value <= 0) {
      errors[`${prefix}DepositAmount`] = 'Enter a valid amount greater than zero';
    } else if (account.depositType === 'percentage' && value > 100) {
      errors[`${prefix}DepositAmount`] = 'Percentage cannot exceed 100';
    }
  }

  return errors;
}

export function validateDirectDeposit(
  data: DirectDepositData,
  proofDocument: UploadedFile | null,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.lastName.trim()) errors.lastName = 'Last name is required';
  if (!data.firstName.trim()) errors.firstName = 'First name is required';

  Object.assign(errors, validateBankAccount(data.primaryAccount, 'primary'));

  if (isBankAccountStarted(data.additionalAccount)) {
    Object.assign(errors, validateBankAccount(data.additionalAccount, 'additional'));
  }

  if (!data.typedSignature.trim()) errors.typedSignature = 'Your signature is required to authorize direct deposit';
  if (!data.signedDate.trim()) errors.signedDate = 'Date is required';

  if (!proofDocument) {
    errors.directDepositProofDocument = 'Upload a voided check or bank document showing your routing and account numbers to complete direct deposit authorization';
  }

  return errors;
}

// ── Vaccine Declination ───────────────────────────────────────────────────────

/**
 * `proofDocument` is this vaccine step's uploaded evidence
 * (`vaccineProofDocuments[stepId]`). It is REQUIRED only when the applicant
 * says they are providing proof; a true declination needs the statement +
 * signature and never a document. An already-uploaded document is simply
 * ignored (not an error, not deleted) if the applicant switches to
 * declining.
 */
export function validateVaccineDeclination(
  entry: AcknowledgementEntry | undefined,
  requiresSignature: boolean,
  proofDocument: UploadedFile | null,
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

  if (entry.decision === 'providing_proof' && !proofDocument) {
    errors.vaccineProofDocument = 'Please upload your proof of vaccination to continue';
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
        if (step.subtype === 'direct_deposit') {
          return validateDirectDeposit(data.directDepositData, data.directDepositProofDocument);
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
            data.vaccineProofDocuments?.[step.id] ?? null,
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
        if (step.subtype === 'resume') return validateResume(data.resumeDocument);
        return validateDocuments(data.uploadedDocuments, step);

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
    case 'flu_declination':  return validateVaccineDeclination(data.acknowledgements[stepId], true, data.vaccineProofDocuments?.[stepId] ?? null);
    case 'safety_acknowledgements': return validateSafety(data.safetyEducation);
    case 'documents':        return validateDocuments(data.uploadedDocuments);
    case 'resume':           return validateResume(data.resumeDocument);
    case 'review':           return {};
    default:                 return {};
  }
}

export function isStepValid(stepId: string, data: OnboardingFormData, step?: PacketStep): boolean {
  return Object.keys(validateStep(stepId, data, step)).length === 0;
}
