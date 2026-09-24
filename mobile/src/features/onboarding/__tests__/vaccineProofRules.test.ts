import { computeStepCompletion, defaultFormData, getPacket, isStepValid, validateVaccineDeclination, type OnboardingFormData } from '@pcs/shared';

// The shared (mobile + Worker + web) rule for vaccination evidence: required
// ONLY when the applicant says they are providing proof.

const PROOF = { name: 'card.pdf', size: 100, type: 'application/pdf', objectKey: 'uploads/1/card.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' };
const PROVIDING = { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' as const };
const DECLINING = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z', decision: 'declining' as const };
const VACCINE_STEP_IDS = ['hep_b_declination', 'tdap_declination', 'flu_declination'];

describe('validateVaccineDeclination — proof requirement', () => {
  it('providing proof without a document is invalid, with a dedicated field error', () => {
    const errors = validateVaccineDeclination(PROVIDING, true, null);
    expect(Object.keys(errors)).toEqual(['vaccineProofDocument']);
  });

  it('providing proof with a document is valid', () => {
    expect(validateVaccineDeclination(PROVIDING, true, PROOF)).toEqual({});
  });

  it('a declination never needs a document', () => {
    expect(validateVaccineDeclination(DECLINING, true, null)).toEqual({});
  });

  it('a declination is still invalid without its own checkbox/signature, regardless of any document', () => {
    const errors = validateVaccineDeclination({ ...DECLINING, checked: false, typedSignature: '' }, true, PROOF);
    expect(Object.keys(errors).sort()).toEqual(['checked', 'typedSignature']);
  });

  it('no decision at all reports only the decision error (no premature proof error)', () => {
    expect(Object.keys(validateVaccineDeclination(undefined, true, null))).toEqual(['decision']);
  });
});

describe.each(VACCINE_STEP_IDS)('%s — validateStep / completion wiring', (stepId) => {
  const packet = ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn'].map((id) => getPacket(id)!).find((p) => p.steps.some((s) => s.id === stepId))!;
  const step = packet.steps.find((s) => s.id === stepId)!;

  function data(entry: object, proofs: OnboardingFormData['vaccineProofDocuments'] = {}): OnboardingFormData {
    return { ...defaultFormData, acknowledgements: { [stepId]: entry as never }, vaccineProofDocuments: proofs };
  }

  it('isStepValid: providing proof needs THIS step\'s proof (another vaccine\'s proof does not count)', () => {
    const other = VACCINE_STEP_IDS.find((id) => id !== stepId)!;
    expect(isStepValid(stepId, data(PROVIDING), step)).toBe(false);
    expect(isStepValid(stepId, data(PROVIDING, { [other]: PROOF }), step)).toBe(false);
    expect(isStepValid(stepId, data(PROVIDING, { [stepId]: PROOF }), step)).toBe(true);
  });

  it('isStepValid: a declination is valid without any proof', () => {
    expect(isStepValid(stepId, data(DECLINING), step)).toBe(true);
  });

  it('step completion: providing proof is 0% until the evidence is uploaded, then 100%', () => {
    expect(computeStepCompletion(data(PROVIDING))[stepId].percent).toBe(0);
    expect(computeStepCompletion(data(PROVIDING, { [stepId]: PROOF }))[stepId].percent).toBe(100);
  });

  it('step completion: a declination is unaffected by proof', () => {
    expect(computeStepCompletion(data(DECLINING))[stepId].percent).toBe(100);
  });
});

describe('packet ordering is unchanged', () => {
  // Pinned from packets.ts (untouched by the vaccine-proof change): the proof
  // upload lives INSIDE each existing vaccine step, so no step was added,
  // removed, or reordered.
  const EXPECTED_ORDER: Record<string, string[]> = {
    general_rn: ["personal_info", "employment_application", "application_statement", "employment_ref_1", "employment_ref_2", "background_auth", "health_info_auth", "patient_bill_of_rights", "hep_b_declination", "tdap_declination", "flu_declination", "w4", "i9", "direct_deposit", "documents", "jcaho_review", "safety_acknowledgements", "safety_exam", "review"],
    icu_rn: ["personal_info", "employment_application", "application_statement", "employment_ref_1", "employment_ref_2", "background_auth", "w4", "i9", "direct_deposit", "documents", "safety_acknowledgements", "review"],
    er_rn: ["personal_info", "employment_application", "application_statement", "employment_ref_1", "employment_ref_2", "background_auth", "w4", "i9", "direct_deposit", "documents", "safety_acknowledgements", "review"],
    lvn: ["personal_info", "employment_application", "application_statement", "employment_ref_1", "employment_ref_2", "background_auth", "health_info_auth", "patient_bill_of_rights", "hep_b_declination", "tdap_declination", "flu_declination", "w4", "i9", "direct_deposit", "documents", "jcaho_review", "safety_acknowledgements", "safety_exam", "review"],
    travel_rn: ["personal_info", "employment_application", "application_statement", "employment_ref_1", "employment_ref_2", "employment_ref_3", "background_auth", "w4", "i9", "direct_deposit", "documents", "safety_acknowledgements", "review"],
  };

  it.each(Object.keys(EXPECTED_ORDER))('%s keeps its exact step order', (packetId) => {
    expect(getPacket(packetId)!.steps.map((s) => s.id)).toEqual(EXPECTED_ORDER[packetId]);
  });
});
