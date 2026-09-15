// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Packet Types
//
// Single source of truth for packet structure consumed by both the
// Cloudflare Worker (validation/session) and Next.js frontend (rendering).
//
// Phase 1: configs are hardcoded constants.
// Phase 2: configs migrate to a D1-backed table + admin UI.
// ─────────────────────────────────────────────────────────────────────────────

export type StepType =
  | 'personal_info'
  | 'government_form'      // official versioned PDFs (I-9, W-4, etc.) — subtype required
  | 'internal_form'        // schema-driven React forms — subtype required
  | 'employment_reference'
  | 'acknowledgement'      // checkbox + typed e-signature policy forms
  | 'exam'
  | 'document_upload'
  | 'review';

// The lifecycle a single step moves through within a session.
export type StepStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'failed'     // used by exam: attempt limit reached without passing
  | 'skipped';   // optional step explicitly skipped

// Map of step IDs → their current status within a session.
export type StepStates = Record<string, StepStatus>;

// ── Step config ───────────────────────────────────────────────────────────────

export interface PacketStepConfig {
  // employment_reference
  referenceNumber?: number;         // 1, 2, 3 — disambiguates multiple reference steps

  // exam
  examType?: string;                // 'safety_education'
  passingScore?: number;            // 0–100, default 80
  maxAttempts?: number;             // default 2

  // document_upload
  requiredUploads?: string[];       // doc type keys: 'nursing_license', 'cpr_cert'
  i9Uploads?: boolean;              // include I-9 identity document slots (List A / B+C)

  // acknowledgement / internal_form / government_form
  acknowledgementId?: string;       // stable ID for the acknowledgement body
  text?: string;                    // body text rendered to the applicant
  requiresSignature?: boolean;      // true = typed e-signature required to advance

  // vaccine declination (hasDeclination === true)
  hasDeclination?: boolean;         // renders as vaccine declination workflow (Yes/No + conditional paths)
  vaccineType?: string;             // 'hep_b' | 'tdap' | 'flu' — drives vaccine-specific copy
}

// ── Packet step ───────────────────────────────────────────────────────────────

export interface PacketStep {
  /** Unique within the packet — used as key in step_states_json and form_data_json. */
  id: string;
  type: StepType;
  /**
   * Narrows rendering within a type family.
   * government_form: 'i9' | 'w4'
   * internal_form:   'employment_application' | 'direct_deposit'
   */
  subtype?: string;
  label: string;
  /** Required steps must be completed before the packet can be submitted. */
  required: boolean;
  config?: PacketStepConfig;
}

// ── Packet ───────────────────────────────────────────────────────────────────

export interface OnboardingPacket {
  /** Stable identifier. Stored on the session and on the submitted application. */
  id: string;
  /**
   * Monotonically increasing version number.
   * Increment when steps are added, removed, or reordered in a way that
   * breaks in-progress sessions.
   */
  version: number;
  /** Human-readable name shown in admin UI. */
  name: string;
  /** Short specialization code stored on the application row. */
  specialization: string;
  steps: PacketStep[];
}

// ── Packet progression utilities ──────────────────────────────────────────────

/**
 * Returns the first step that is not yet completed, or null if every step
 * (required AND optional) is completed. This is "first incomplete step,"
 * not "next required action" — an incomplete OPTIONAL step (e.g. a
 * packet's extra, non-required employment reference) is returned just the
 * same as an incomplete required one. Kept intentionally distinct from
 * resolveNextRequiredStep() below rather than redefined, since a shared
 * function's meaning shouldn't change silently underneath any consumer
 * that specifically wants "every step, regardless of required."
 */
export function resolveCurrentStep(
  packet: OnboardingPacket,
  stepStates: StepStates,
): PacketStep | null {
  return (
    packet.steps.find(s => (stepStates[s.id] ?? 'not_started') !== 'completed') ?? null
  );
}

/**
 * Returns the first REQUIRED step that is not yet completed, or null once
 * every required step is done (optional steps may still be open). This is
 * the "what does the applicant actually need to do next" answer — an
 * incomplete optional step (e.g. a packet's non-required extra employment
 * reference) is never returned here, so it can never look mandatory or
 * block progress toward the real next required action.
 */
export function resolveNextRequiredStep(
  packet: OnboardingPacket,
  stepStates: StepStates,
): PacketStep | null {
  return (
    packet.steps.find(s => s.required && (stepStates[s.id] ?? 'not_started') !== 'completed') ?? null
  );
}

/** Returns the 0-based index of a step by its ID, or -1 if not found. */
export function getStepIndex(packet: OnboardingPacket, stepId: string): number {
  return packet.steps.findIndex(s => s.id === stepId);
}

/** Returns true when all required steps are completed. */
export function isPacketComplete(
  packet: OnboardingPacket,
  stepStates: StepStates,
): boolean {
  return packet.steps
    .filter(s => s.required)
    .every(s => stepStates[s.id] === 'completed');
}

/**
 * Returns true when the applicant may navigate to targetStepId.
 * All required steps that appear before the target must be completed.
 */
export function canNavigateToStep(
  packet: OnboardingPacket,
  stepStates: StepStates,
  targetStepId: string,
): boolean {
  const targetIndex = getStepIndex(packet, targetStepId);
  if (targetIndex === -1) return false;
  return packet.steps
    .slice(0, targetIndex)
    .filter(s => s.required)
    .every(s => stepStates[s.id] === 'completed');
}

// ── Phase 1 packet definitions ────────────────────────────────────────────────
//
// When adding or removing steps, bump the version number so sessions that
// started on a previous version are not corrupted.

// Full 19-step GENERAL_RN packet per OnboardingFlow.pdf.
// Used only by general_rn and lvn; specialty packets build from VARIANT_BASE_STEPS.
const GENERAL_RN_STEPS: PacketStep[] = [
  // Phase 1 — Personal Information
  {
    id:       'personal_info',
    type:     'personal_info',
    label:    'Personal Information',
    required: true,
  },

  // Phase 2 — Application Forms & Employment References
  {
    id:       'employment_application',
    type:     'internal_form',
    subtype:  'employment_application',
    label:    'Employment Application',
    required: true,
    config:   { requiresSignature: true },
  },
  {
    id:       'application_statement',
    type:     'acknowledgement',
    label:    'Applicant Statement',
    required: true,
    config:   {
      acknowledgementId: 'application_statement',
      requiresSignature: true,
      text:
        'I certify that the answers given herein are true and complete to the best of my knowledge. I authorize investigation of all statements contained in this application for employment as may be necessary in arriving at an employment decision.\n\n' +
        'I understand that this application is not, and is not intended to be, a contract of employment. I understand that if employed, my employment will be at-will and may be terminated at any time, with or without notice, by either myself or by Paramount Care Staffing, LLC.\n\n' +
        'I understand that any misrepresentation or omission of facts called for in this application, whether on this document or in connection with my interview, or related to the application process, may disqualify me from further consideration for employment, and if employed, may result in my immediate discharge. I further understand and agree that my employment and compensation can be terminated, with or without cause, and with or without notice, at any time, at the option of either the company or myself.\n\n' +
        'I authorize Paramount Care Staffing, LLC to make thorough investigations of my past employment, education, personal history, and credit record, and I release from all liability all persons and organizations reporting information in connection with this authorization. I also authorize the schools, previous employers, references, and other individuals I have listed to give information about me. I release all such parties from any liability for providing such information.\n\n' +
        'I understand that a background check, drug and alcohol screening, and verification of professional licensure will be conducted as a condition of employment.',
    },
  },

  // Employment References (collected immediately after application statement, before background auth)
  {
    id:       'employment_ref_1',
    type:     'employment_reference',
    label:    'Employment Reference #1',
    required: true,
    config:   { referenceNumber: 1 },
  },
  {
    id:       'employment_ref_2',
    type:     'employment_reference',
    label:    'Employment Reference #2',
    required: true,
    config:   { referenceNumber: 2 },
  },

  // Phase 3 — Background & Health Authorizations
  {
    id:       'background_auth',
    type:     'acknowledgement',
    label:    'Background Investigation & Drug/Alcohol Testing Authorization',
    required: true,
    config:   {
      acknowledgementId: 'background_auth',
      requiresSignature: true,
      text:
        'BACKGROUND INVESTIGATION AUTHORIZATION\n\n' +
        'I, the undersigned, do hereby authorize Paramount Care Staffing, LLC and/or its designated agents and representatives to conduct a comprehensive review of my background through a consumer reporting agency or investigative consumer reporting agency. I understand that this review may include, but is not limited to, the following areas: criminal history (federal, state, and local), employment verification, professional license verification, sex offender registry check, and reference checks.\n\n' +
        'I understand that in accordance with the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq., I have certain rights with respect to consumer reports and investigative consumer reports, including the right to request disclosure of the nature and scope of any investigation.\n\n' +
        'DRUG AND ALCOHOL TESTING AUTHORIZATION\n\n' +
        'I authorize Paramount Care Staffing, LLC to conduct pre-employment and random drug and alcohol testing as a condition of employment and continued employment. I consent to the release of drug and alcohol test results to Paramount Care Staffing, LLC and to any client facilities to which I may be assigned. I understand that a positive drug or alcohol test result, refusal to test, or adulteration of a specimen will result in disqualification or immediate termination of employment.\n\n' +
        'I authorize any physician, hospital, clinic, or other healthcare entity to release my drug and/or alcohol test results to Paramount Care Staffing, LLC and its authorized representatives. I agree to hold harmless and indemnify Paramount Care Staffing, LLC, its employees, and agents for any claims arising from the testing process or the use of test results in employment decisions, to the extent permitted by law.',
    },
  },
  {
    id:       'health_info_auth',
    type:     'acknowledgement',
    label:    'Disclosure of Health Information Authorization',
    required: true,
    config:   {
      acknowledgementId: 'health_info_auth',
      requiresSignature: true,
      text:
        'AUTHORIZATION FOR DISCLOSURE OF HEALTH INFORMATION\n\n' +
        'I, the undersigned, hereby authorize the use and disclosure of my health information as described below. This authorization is given voluntarily and in connection with my employment application and placement through Paramount Care Staffing, LLC.\n\n' +
        'INFORMATION TO BE DISCLOSED: Immunization and vaccination records (including but not limited to Hepatitis B, Influenza, Tdap, MMR, Varicella, and TB/PPD test results); results of pre-employment physical examinations; drug and alcohol test results; fit-for-duty evaluations; and any other health information required by applicable law or facility policy for placement in a healthcare environment.\n\n' +
        'PURPOSE OF DISCLOSURE: To verify fitness for duty in a healthcare setting; to comply with applicable federal, state, and local laws and regulations governing healthcare workers; to satisfy requirements of client healthcare facilities; and to protect the health and safety of patients and fellow healthcare workers.\n\n' +
        'PERSONS AUTHORIZED TO RECEIVE INFORMATION: Paramount Care Staffing, LLC; client healthcare facilities to which I am or may be assigned; and any regulatory bodies with jurisdiction over healthcare workforce compliance.\n\n' +
        'I understand that I have the right to revoke this authorization at any time by providing written notice to Paramount Care Staffing, LLC, except to the extent that action has already been taken in reliance on this authorization. I understand that revocation of this authorization may affect my ability to be placed in clinical assignments. I understand that the information used or disclosed pursuant to this authorization may be subject to re-disclosure by the recipient and may no longer be protected by HIPAA privacy rules.',
    },
  },
  {
    id:       'patient_bill_of_rights',
    type:     'acknowledgement',
    label:    'Patient Bill of Rights',
    required: true,
    config:   {
      acknowledgementId: 'patient_bill_of_rights',
      requiresSignature: true,
      text:
        'PATIENT BILL OF RIGHTS — ACKNOWLEDGMENT\n\n' +
        'As a healthcare professional placed through Paramount Care Staffing, LLC, I acknowledge and commit to upholding the following patient rights in every care interaction:\n\n' +
        'RIGHT TO DIGNITY AND RESPECT: Every patient has the right to considerate and respectful care, treating them with dignity regardless of age, gender, race, color, religion, national origin, disability, sexual orientation, or source of payment.\n\n' +
        'RIGHT TO INFORMATION: Patients have the right to receive complete, current information concerning their diagnosis, treatment, and prognosis in terms they can reasonably be expected to understand. When it is not medically advisable to give such information, information shall be made available to an appropriate person on their behalf.\n\n' +
        'RIGHT TO INFORMED CONSENT: Patients have the right to receive information necessary to give informed consent prior to the start of any procedure or treatment. This includes information about the specific procedure or treatment, significant medical risks, and medically significant alternatives.\n\n' +
        'RIGHT TO REFUSE TREATMENT: Patients have the right to refuse treatment to the extent permitted by law and to be informed of the medical consequences of such refusal.\n\n' +
        'RIGHT TO PRIVACY AND CONFIDENTIALITY: Patient case discussion, consultation, examination, and treatment are confidential and should be conducted discreetly. Patients have the right to expect that all communications and records pertaining to their care will be treated as confidential in accordance with HIPAA and applicable state law.\n\n' +
        'RIGHT TO SAFE CARE: Patients have the right to receive care in a safe setting, free from all forms of abuse, harassment, or exploitation.\n\n' +
        'I commit to actively upholding these rights in all patient interactions and to immediately report any observed violations to the appropriate supervisor or compliance officer.',
    },
  },

  // Phase 4 — Declinations
  {
    id:       'hep_b_declination',
    type:     'acknowledgement',
    label:    'Hepatitis B (HBV) Vaccine',
    required: true,
    config:   {
      acknowledgementId: 'hep_b_declination',
      requiresSignature: true,
      hasDeclination:    true,
      vaccineType:       'hep_b',
      text:
        'HEPATITIS B VACCINE — DECLINATION STATEMENT\n\n' +
        'I understand that due to my occupational exposure to blood or other potentially infectious materials, I may be at risk of acquiring Hepatitis B virus (HBV) infection. I have been given the opportunity to be vaccinated with the Hepatitis B vaccine series at no charge to myself.\n\n' +
        'I decline Hepatitis B vaccination at this time. I understand that by declining this vaccine I continue to be at risk of acquiring Hepatitis B, a serious disease. If in the future I continue to have occupational exposure to blood or other potentially infectious materials and I wish to be vaccinated, I may receive the Hepatitis B vaccine series at no charge.\n\n' +
        'This declination is made pursuant to OSHA\'s Bloodborne Pathogens Standard (29 CFR 1910.1030) and will be retained in my occupational health record maintained by Paramount Care Staffing, LLC. I understand that I may revoke this declination at any time and request the vaccine series at no cost to me.',
    },
  },
  {
    id:       'tdap_declination',
    type:     'acknowledgement',
    label:    'Tdap Vaccine',
    required: true,
    config:   {
      acknowledgementId: 'tdap_declination',
      requiresSignature: true,
      hasDeclination:    true,
      vaccineType:       'tdap',
      text:
        'TDAP (TETANUS, DIPHTHERIA & PERTUSSIS) VACCINE — DECLINATION STATEMENT\n\n' +
        'I have been offered the Tdap vaccine and have been informed of the benefits of receiving this vaccine, including protection against pertussis (whooping cough), which can be life-threatening for vulnerable patient populations including infants and immunocompromised individuals.\n\n' +
        'I understand that as a healthcare worker I am at increased risk of transmitting pertussis to vulnerable patients in my care, and that the Centers for Disease Control and Prevention (CDC) and the Advisory Committee on Immunization Practices (ACIP) recommend Tdap vaccination for all healthcare personnel who have not previously received Tdap as an adult.\n\n' +
        'Having been fully informed of the benefits and risks, I voluntarily decline to receive the Tdap vaccine at this time. I understand that this declination will be documented in my occupational health record maintained by Paramount Care Staffing, LLC, and that I may be subject to additional precautions or facility restrictions during pertussis outbreaks. I understand that I may request the Tdap vaccine at any time.',
    },
  },
  {
    id:       'flu_declination',
    type:     'acknowledgement',
    label:    'Influenza / H1N1 Vaccine',
    required: true,
    config:   {
      acknowledgementId: 'flu_declination',
      requiresSignature: true,
      hasDeclination:    true,
      vaccineType:       'flu',
      text:
        'INFLUENZA / H1N1 VACCINE — DECLINATION STATEMENT\n\n' +
        'I have been offered the seasonal Influenza/H1N1 vaccine and have been informed of the following:\n\n' +
        'The influenza vaccine is recommended annually for all healthcare workers by the CDC and ACIP to protect both healthcare personnel and their patients from seasonal influenza. Influenza can cause serious illness, hospitalization, and death — particularly in high-risk populations including the elderly, infants, and immunocompromised individuals who I may care for in clinical assignments.\n\n' +
        'Healthcare workers who are not vaccinated have been shown to transmit influenza to vulnerable patients, contributing to significant morbidity and mortality. Some client facilities require influenza vaccination as a condition of placement.\n\n' +
        'Having been fully informed of the benefits of influenza vaccination for myself and for the patients in my care, I voluntarily decline influenza/H1N1 vaccination at this time. I understand that declining this vaccine may limit my available clinical assignments. I agree to follow any facility-specific masking or precautionary policies applicable to unvaccinated healthcare workers during influenza season. I may request the vaccine at any time.',
    },
  },

  // Phase 5 — Tax & Government Forms + Direct Deposit
  {
    id:       'w4',
    type:     'government_form',
    subtype:  'w4',
    label:    'Tax Forms / W-4',
    required: true,
    config:   { requiresSignature: true },
  },
  {
    id:       'i9',
    type:     'government_form',
    subtype:  'i9',
    label:    'Form I-9 (Section 1)',
    required: true,
    config:   { requiresSignature: true },
  },
  {
    id:       'direct_deposit',
    type:     'internal_form',
    subtype:  'direct_deposit',
    label:    'Direct Deposit Authorization',
    required: true,
    config:   { requiresSignature: true },
  },

  // Phase 6 — Document Uploads
  {
    id:       'documents',
    type:     'document_upload',
    label:    'License & Credential Uploads',
    required: true,
    config:   {
      i9Uploads:       true,
      requiredUploads: ['nursing_license', 'cpr_cert'],
    },
  },

  // Phase 7 — Safety & JCAHO
  {
    id:       'jcaho_review',
    type:     'acknowledgement',
    label:    'JCAHO / TJC Standards Review',
    required: true,
    config:   {
      acknowledgementId: 'jcaho_review',
      requiresSignature: true,
      text:
        'THE JOINT COMMISSION (TJC / JCAHO) STANDARDS REVIEW\n\n' +
        'I acknowledge that I have been informed of and understand the following Joint Commission standards and National Patient Safety Goals applicable to my role as a healthcare professional:\n\n' +
        'PATIENT IDENTIFICATION: I will use at least two patient identifiers (e.g., full name and date of birth) before administering medications, blood products, or collecting specimens, and before any procedure or treatment.\n\n' +
        'EFFECTIVE COMMUNICATION: I will use a standardized handoff communication process (e.g., SBAR) when transferring patient care responsibility. I will read back verbal or telephone orders and critical test results to verify accuracy.\n\n' +
        'MEDICATION SAFETY: I will label all medications and solutions removed from their original containers. I will review and reconcile patient medications at transitions of care. I will be vigilant about high-alert medications.\n\n' +
        'INFECTION CONTROL: I will follow evidence-based hand hygiene guidelines as established by the CDC and WHO. I will adhere to all standard and transmission-based precautions appropriate to each patient situation.\n\n' +
        'FALL PREVENTION: I will assess and reassess patient fall risk and implement appropriate fall prevention strategies, including bed alarm use, non-slip footwear, and patient/family education.\n\n' +
        'DOCUMENTATION: I will document patient care accurately, completely, and in a timely manner in accordance with facility policy and applicable standards.\n\n' +
        'I commit to upholding these standards in all clinical assignments and to immediately reporting any patient safety concerns to the appropriate supervisor.',
    },
  },
  {
    id:       'safety_acknowledgements',
    type:     'acknowledgement',
    label:    'Safety & Education Exam',
    required: true,
    config:   { acknowledgementId: 'safety_acknowledgements', requiresSignature: false },
  },

  // Phase 8 — Specialization Exam
  {
    id:       'safety_exam',
    type:     'exam',
    label:    'Clinical Competency Exam',
    required: false,
    config:   { examType: 'clinical_competency', passingScore: 80, maxAttempts: 2 },
  },

  // Phase 9 — Review & Submit
  {
    id:       'review',
    type:     'review',
    label:    'Review & Submit',
    required: true,
  },
];

// Shared base steps for specialty variant packets (ICU, ER, Travel).
// These use a condensed flow — declinations and some acknowledgements are omitted
// in favor of the specialization-specific orientation they receive on-site.
const VARIANT_BASE_STEPS: PacketStep[] = [
  { id: 'personal_info',       type: 'personal_info',        label: 'Personal Information',          required: true },
  { id: 'employment_application', type: 'internal_form', subtype: 'employment_application',
    label: 'Employment Application', required: true, config: { requiresSignature: true } },
  { id: 'application_statement',  type: 'acknowledgement',
    label: 'Applicant Statement', required: true,
    config: { acknowledgementId: 'application_statement', requiresSignature: true,
      text: 'I certify that the answers given herein are true and complete to the best of my knowledge. I authorize investigation of all statements contained in this application for employment as may be necessary in arriving at an employment decision.\n\nI understand that this application is not, and is not intended to be, a contract of employment. I understand that if employed, my employment will be at-will and may be terminated at any time, with or without notice, by either myself or by Paramount Care Staffing, LLC.\n\nI understand that any misrepresentation or omission of facts called for in this application may disqualify me from further consideration for employment, and if employed, may result in my immediate discharge.' } },
  { id: 'employment_ref_1',    type: 'employment_reference', label: 'Employment Reference #1',       required: true, config: { referenceNumber: 1 } },
  { id: 'background_auth',     type: 'acknowledgement',      label: 'Background Investigation & Drug/Alcohol Testing Authorization', required: true,
    config: { acknowledgementId: 'background_auth', requiresSignature: true,
      text: 'I hereby authorize Paramount Care Staffing, LLC and/or its designated agents and representatives to conduct a comprehensive review of my background through a consumer reporting agency. I understand this may include criminal history, employment verification, professional license verification, sex offender registry check, and reference checks.\n\nI also authorize Paramount Care Staffing, LLC to conduct pre-employment and random drug and alcohol testing as a condition of employment and continued employment. I consent to the release of test results to Paramount Care Staffing, LLC and to any client facilities to which I may be assigned.' } },
  { id: 'w4',                  type: 'government_form',  subtype: 'w4',   label: 'Tax Forms / W-4',              required: true, config: { requiresSignature: true } },
  { id: 'i9',                  type: 'government_form',  subtype: 'i9',   label: 'Form I-9 (Section 1)',         required: true, config: { requiresSignature: true } },
  { id: 'direct_deposit',      type: 'internal_form',    subtype: 'direct_deposit', label: 'Direct Deposit Authorization', required: true, config: { requiresSignature: true } },
  { id: 'documents',           type: 'document_upload',      label: 'License & Credential Uploads',  required: true, config: { i9Uploads: true, requiredUploads: ['nursing_license', 'cpr_cert'] } },
  { id: 'safety_acknowledgements', type: 'acknowledgement',  label: 'Safety & Education Exam',       required: true, config: { acknowledgementId: 'safety_acknowledgements', requiresSignature: false } },
  { id: 'review',              type: 'review',               label: 'Review & Submit',               required: true },
];

const TWO_REFS_EXTRA: PacketStep = {
  id:       'employment_ref_2',
  type:     'employment_reference',
  label:    'Employment Reference #2',
  required: true,
  config:   { referenceNumber: 2 },
};

const THREE_REFS_EXTRA: PacketStep = {
  id:       'employment_ref_3',
  type:     'employment_reference',
  label:    'Employment Reference #3',
  required: false,
  config:   { referenceNumber: 3 },
};

function insertAfter(steps: PacketStep[], afterId: string, ...inserts: PacketStep[]): PacketStep[] {
  const idx = steps.findIndex(s => s.id === afterId);
  if (idx === -1) return [...steps, ...inserts];
  return [...steps.slice(0, idx + 1), ...inserts, ...steps.slice(idx + 1)];
}

export const PACKETS: Record<string, OnboardingPacket> = {
  general_rn: {
    id:             'general_rn',
    version:        5,
    name:           'Registered Nurse',
    specialization: 'RN',
    steps:          GENERAL_RN_STEPS,
  },

  icu_rn: {
    id:             'icu_rn',
    version:        5,
    name:           'ICU Nurse',
    specialization: 'ICU',
    steps:          insertAfter(VARIANT_BASE_STEPS, 'employment_ref_1', TWO_REFS_EXTRA),
  },

  er_rn: {
    id:             'er_rn',
    version:        5,
    name:           'ER Nurse',
    specialization: 'ER',
    steps:          insertAfter(VARIANT_BASE_STEPS, 'employment_ref_1', TWO_REFS_EXTRA),
  },

  lvn: {
    id:             'lvn',
    version:        5,
    name:           'Licensed Vocational Nurse',
    specialization: 'LVN',
    steps:          GENERAL_RN_STEPS,
  },

  travel_rn: {
    id:             'travel_rn',
    version:        5,
    name:           'Travel Nurse',
    specialization: 'Travel',
    steps:          insertAfter(
      insertAfter(VARIANT_BASE_STEPS, 'employment_ref_1', TWO_REFS_EXTRA),
      'employment_ref_2',
      THREE_REFS_EXTRA,
    ),
  },
};

export const DEFAULT_PACKET_ID = 'general_rn';

export function getPacket(id: string): OnboardingPacket | null {
  return PACKETS[id] ?? null;
}
