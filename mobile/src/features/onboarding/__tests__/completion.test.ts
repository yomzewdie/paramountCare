import { computeOverallCompletion, computeStepCompletion, defaultFormData, getPacket, PACKETS, type OnboardingFormData } from '@pcs/shared';

// M11: computeOverallCompletion() is now fully packet-aware — it no longer
// takes a hardcoded step-id list (M10's own fix was exactly such a list,
// already documented there as a targeted-not-general fix). It now derives
// which steps count entirely from the given packet's own `steps` (required,
// non-review, and actually computable) — see packages/shared/src/
// completion.ts and ADR-023. These tests exercise the real, unmodified
// shared function directly against real packets, never a reimplementation
// of its filtering logic.

const VALID_APPLICATION = {
  ...defaultFormData.employmentApplication,
  positionApplied: 'RN', specialtyPreference: 'Med-Surg', shiftPreference: 'day', employmentType: 'full_time',
  licenseType: 'RN', licenseNumber: 'RN123', licenseState: 'CA', licenseExpiration: '2027-01-01',
  yearsExperience: '3-5', primarySpecialty: 'Med-Surg',
  authorizedToWork: true, hasConviction: false, hasLicenseDiscipline: false, hasLicenseRevocation: false, underInvestigation: false,
  emergencyContactName: 'Jane Smith', emergencyContactRelationship: 'Spouse', emergencyContactPhone: '555-000-1111',
};

const VALID_REFERENCE = {
  positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
  employerName: 'Test Hospital', employerCity: 'Test City', employerState: 'CA',
  supervisorName: 'Test Supervisor', supervisorPhone: '555-000-1111',
  permissionGranted: true, reasonForLeaving: 'Contract ended', eligibleForRehire: true,
  rehireDetails: '', comments: '',
};

const SIGNED_ACK = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z' };

const VALID_UPLOAD = { name: 'file.pdf', size: 100, type: 'application/pdf' };

/** A single, comprehensive "everything a real applicant could ever need to
 * fill in is complete" fixture — covers every step ANY packet might
 * require. Passed to computeOverallCompletion() for different packets to
 * prove each packet only counts what it actually contains. */
const FULLY_COMPLETE_FORM_DATA: OnboardingFormData = {
  ...defaultFormData,
  personalInfo: { ...defaultFormData.personalInfo, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '555-000-1111', address: '123 Main St', city: 'LA', state: 'CA', zip: '90001' },
  employmentApplication: VALID_APPLICATION,
  w4Data: { ...defaultFormData.w4Data, firstNameMI: 'Jane', lastName: 'Doe', ssn: '123-45-6789', address: '123 Main St', cityStateZip: 'LA, CA 90001', filingStatus: 'single_mfs', typedSignature: 'Jane Doe', signedDate: '01/01/2026' },
  i9Data: { ...defaultFormData.i9Data, dateOfBirth: '01/01/1990', citizenshipStatus: 'citizen', i9SignatureType: 'typed', i9TypedSignature: 'Jane Doe' },
  employmentReferences: { employment_ref_1: VALID_REFERENCE, employment_ref_2: VALID_REFERENCE, employment_ref_3: VALID_REFERENCE },
  safetyEducation: {
    patientSafety: true, infectionControl: true, fireSafety: true, patientRightsHipaa: true,
    workplaceViolence: true, backSafety: true, hazardousMaterials: true, documentationStandards: true, examAttestation: true,
  },
  uploadedDocuments: { listA: VALID_UPLOAD, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD },
  acknowledgements: {
    application_statement: SIGNED_ACK,
    background_auth: SIGNED_ACK,
    health_info_auth: SIGNED_ACK,
    patient_bill_of_rights: SIGNED_ACK,
    jcaho_review: SIGNED_ACK,
    hep_b_declination: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' },
    tdap_declination: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' },
    flu_declination: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' },
  },
  // "Providing proof" is only complete once the evidence is uploaded.
  vaccineProofDocuments: { hep_b_declination: VALID_UPLOAD, tdap_declination: VALID_UPLOAD, flu_declination: VALID_UPLOAD },
  // M13: direct_deposit has its own dedicated completion model (a bank
  // account + signature + voided-check proof) — no longer a generic
  // acknowledgement entry. See packages/shared/src/completion.ts.
  directDepositData: {
    ...defaultFormData.directDepositData,
    lastName: 'Doe', firstName: 'Jane',
    primaryAccount: {
      bankName: 'Test Bank', accountType: 'checking',
      routingNumber: '011000015', accountNumber: '1234567890',
      depositType: 'percentage', depositAmount: '100',
    },
    typedSignature: 'Jane Doe', signedDate: '01/01/2026',
  },
  directDepositProofDocument: VALID_UPLOAD,
};

describe('computeOverallCompletion — fully packet-aware (M11)', () => {
  it('all required, content-bearing steps complete → 100%, for General RN', () => {
    expect(computeOverallCompletion(getPacket('general_rn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });

  it('all required, content-bearing steps complete → 100%, for LVN', () => {
    expect(computeOverallCompletion(getPacket('lvn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });

  it('all required, content-bearing steps complete → 100%, for ICU RN', () => {
    expect(computeOverallCompletion(getPacket('icu_rn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });

  it('all required, content-bearing steps complete → 100%, for ER RN', () => {
    expect(computeOverallCompletion(getPacket('er_rn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });

  it('all required, content-bearing steps complete → 100%, for Travel RN, even though optional employment_ref_3 is not evaluated for "required completion"', () => {
    expect(computeOverallCompletion(getPacket('travel_rn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });

  it('a step absent from the applicant\'s packet never counts — icu_rn has no health_info_auth/patient_bill_of_rights/vaccine declinations', () => {
    // Same fully-complete data works for general_rn (has these steps) and
    // icu_rn (does not) — icu_rn still reaches 100% without them counting
    // for OR against it, proving they're genuinely excluded, not silently
    // required-but-coincidentally-satisfied.
    const withoutHealthSteps: OnboardingFormData = {
      ...FULLY_COMPLETE_FORM_DATA,
      acknowledgements: {
        ...FULLY_COMPLETE_FORM_DATA.acknowledgements,
        health_info_auth: { checked: false, typedSignature: '', signedAt: '' },
        patient_bill_of_rights: { checked: false, typedSignature: '', signedAt: '' },
      },
    };
    // general_rn requires these — leaving them unsigned must block 100%.
    expect(computeOverallCompletion(getPacket('general_rn')!, withoutHealthSteps)).toBeLessThan(100);
    // icu_rn doesn't have these steps at all — unaffected, still 100%.
    expect(computeOverallCompletion(getPacket('icu_rn')!, withoutHealthSteps)).toBe(100);
  });

  it('a required incomplete step blocks 100%, for whichever packet actually requires it', () => {
    const missingW4Signature: OnboardingFormData = {
      ...FULLY_COMPLETE_FORM_DATA,
      w4Data: { ...FULLY_COMPLETE_FORM_DATA.w4Data, typedSignature: '' },
    };
    expect(computeOverallCompletion(getPacket('icu_rn')!, missingW4Signature)).toBeLessThan(100);
  });

  it('leaving the OPTIONAL employment_ref_3 completely empty does not prevent Travel RN from reaching 100%', () => {
    const withoutRef3: OnboardingFormData = {
      ...FULLY_COMPLETE_FORM_DATA,
      employmentReferences: {
        employment_ref_1: FULLY_COMPLETE_FORM_DATA.employmentReferences.employment_ref_1,
        employment_ref_2: FULLY_COMPLETE_FORM_DATA.employmentReferences.employment_ref_2,
        // employment_ref_3 intentionally absent entirely
      },
    };
    expect(computeOverallCompletion(getPacket('travel_rn')!, withoutRef3)).toBe(100);
  });

  it('completing employment_ref_3 (optional) never changes the percentage either way', () => {
    const withoutRef3: OnboardingFormData = {
      ...FULLY_COMPLETE_FORM_DATA,
      employmentReferences: {
        employment_ref_1: FULLY_COMPLETE_FORM_DATA.employmentReferences.employment_ref_1,
        employment_ref_2: FULLY_COMPLETE_FORM_DATA.employmentReferences.employment_ref_2,
      },
    };
    const withRef3 = FULLY_COMPLETE_FORM_DATA;
    expect(computeOverallCompletion(getPacket('travel_rn')!, withoutRef3))
      .toBe(computeOverallCompletion(getPacket('travel_rn')!, withRef3));
  });

  it('an empty applicant scores 0% for every packet — no step accidentally starts "free"', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      expect(computeOverallCompletion(getPacket(packetId)!, defaultFormData)).toBe(0);
    }
  });

  it('completing a branch-specific step (health_info_auth) advances ONLY the packets that actually require it', () => {
    const withHealthAuthOnly: OnboardingFormData = {
      ...defaultFormData,
      acknowledgements: { ...defaultFormData.acknowledgements, health_info_auth: SIGNED_ACK },
    };
    expect(computeOverallCompletion(getPacket('general_rn')!, withHealthAuthOnly))
      .toBeGreaterThan(computeOverallCompletion(getPacket('general_rn')!, defaultFormData));
    // icu_rn has no health_info_auth step at all — identical before/after.
    expect(computeOverallCompletion(getPacket('icu_rn')!, withHealthAuthOnly))
      .toBe(computeOverallCompletion(getPacket('icu_rn')!, defaultFormData));
  });

  it('completing a branch-specific step (w4) advances ONLY the packets that actually require it at this point', () => {
    const withW4Only: OnboardingFormData = {
      ...defaultFormData,
      w4Data: FULLY_COMPLETE_FORM_DATA.w4Data,
    };
    expect(computeOverallCompletion(getPacket('icu_rn')!, withW4Only))
      .toBeGreaterThan(computeOverallCompletion(getPacket('icu_rn')!, defaultFormData));
  });

  it('the "review" step never participates — completing everything else already reaches 100% without it contributing extra weight', () => {
    // review always reports {completed:1,total:1} regardless of applicant
    // data; confirmed excluded by construction (type: 'review').
    expect(computeOverallCompletion(getPacket('general_rn')!, FULLY_COMPLETE_FORM_DATA)).toBe(100);
  });
});

/**
 * Coverage/invariant regression suite requested after the M11 report:
 * proves — against the REAL, unmodified packet definitions and the REAL
 * computeStepCompletion()/computeOverallCompletion(), never a
 * reimplementation of either — that no required, onboarding-completion-
 * participating step can silently fall through the denominator because
 * its evaluator is missing, and that the required/optional/review
 * distinctions computeOverallCompletion relies on hold for every packet
 * that exists today, not just the ones exercised above.
 *
 * `Object.keys(PACKETS)` is used throughout (not a hardcoded packet-id
 * array) so this suite automatically covers any packet added later
 * without needing to be remembered and updated by hand.
 */
describe('completion-evaluator coverage invariant', () => {
  it('every required, non-review step in every current packet has a registered completion evaluator', () => {
    const completions = computeStepCompletion(defaultFormData);
    const missing: string[] = [];
    for (const packetId of Object.keys(PACKETS)) {
      const packet = getPacket(packetId)!;
      for (const step of packet.steps) {
        if (step.required && step.type !== 'review' && completions[step.id] === undefined) {
          missing.push(`${packetId}:${step.id} (type=${step.type}${step.subtype ? `/${step.subtype}` : ''})`);
        }
      }
    }
    // If this ever fails, the failure message below names exactly which
    // packet+step is silently excluded from the progress denominator.
    // Investigated as of M11: the one required-looking gap that could
    // exist — an `exam`-type step — never appears here because every
    // current `exam` step (`safety_exam`) is `required: false`. If a
    // FUTURE required exam (or any other step type with no defined
    // completion algorithm) is ever added, computeStepCompletion() needs
    // an explicit evaluator for it — completion participation should
    // never be inferred from a step merely existing.
    expect(missing).toEqual([]);
  });

  it('reaching 100% requires EVERY required, non-review, evaluator-covered step to be individually complete — 100% can never mask a partially-complete step', () => {
    for (const packetId of Object.keys(PACKETS)) {
      const packet = getPacket(packetId)!;
      const completions = computeStepCompletion(FULLY_COMPLETE_FORM_DATA);
      const contentSteps = packet.steps.filter((s) => s.required && s.type !== 'review' && completions[s.id] !== undefined);

      expect(contentSteps.length).toBeGreaterThan(0); // every packet has real content steps
      for (const step of contentSteps) {
        expect(completions[step.id].completed).toBe(completions[step.id].total);
      }
      expect(computeOverallCompletion(packet, FULLY_COMPLETE_FORM_DATA)).toBe(100);
    }
  });

  it('no packet reports 100% while starting from a completely empty applicant — an empty required step can never be silently "free"', () => {
    for (const packetId of Object.keys(PACKETS)) {
      expect(computeOverallCompletion(getPacket(packetId)!, defaultFormData)).toBe(0);
    }
  });

  it('every packet containing an optional, evaluator-covered step (employment_ref_3) can still reach 100% while that step is entirely absent', () => {
    const packetsWithRef3 = Object.keys(PACKETS).filter((id) => getPacket(id)!.steps.some((s) => s.id === 'employment_ref_3'));
    expect(packetsWithRef3.length).toBeGreaterThan(0); // sanity: this case actually exists today (Travel RN)

    for (const packetId of packetsWithRef3) {
      const packet = getPacket(packetId)!;
      expect(packet.steps.find((s) => s.id === 'employment_ref_3')?.required).toBe(false);
      const otherRefs = Object.fromEntries(
        Object.entries(FULLY_COMPLETE_FORM_DATA.employmentReferences).filter(([id]) => id !== 'employment_ref_3'),
      );
      const withoutRef3: OnboardingFormData = { ...FULLY_COMPLETE_FORM_DATA, employmentReferences: otherRefs };
      expect(computeOverallCompletion(packet, withoutRef3)).toBe(100);
    }
  });

  it('M15: safety_acknowledgements blocks 100% until all 9 booleans (8 topics + attestation) are true, for every packet that requires it', () => {
    for (const packetId of Object.keys(PACKETS)) {
      const packet = getPacket(packetId)!;
      if (!packet.steps.some((s) => s.id === 'safety_acknowledgements')) continue;

      const missingAttestation: OnboardingFormData = {
        ...FULLY_COMPLETE_FORM_DATA,
        safetyEducation: { ...FULLY_COMPLETE_FORM_DATA.safetyEducation, examAttestation: false },
      };
      expect(computeOverallCompletion(packet, missingAttestation)).toBeLessThan(100);

      const missingOneTopic: OnboardingFormData = {
        ...FULLY_COMPLETE_FORM_DATA,
        safetyEducation: { ...FULLY_COMPLETE_FORM_DATA.safetyEducation, fireSafety: false },
      };
      expect(computeOverallCompletion(packet, missingOneTopic)).toBeLessThan(100);
    }
  });

  it('M15: the OPTIONAL safety_exam step never blocks a General RN/LVN packet from reaching 100%, and has no evaluator entry at all', () => {
    const completions = computeStepCompletion(FULLY_COMPLETE_FORM_DATA);
    expect(completions.safety_exam).toBeUndefined();
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const examStep = packet.steps.find((s) => s.id === 'safety_exam');
      expect(examStep).toBeDefined();
      expect(examStep!.required).toBe(false);
      // FULLY_COMPLETE_FORM_DATA has no safety_exam data at all (no
      // shared field even exists for it), yet these packets still reach
      // 100% — proving the optional exam is genuinely never counted.
      expect(computeOverallCompletion(packet, FULLY_COMPLETE_FORM_DATA)).toBe(100);
    }
  });

  it('the "review" step type retains its always-complete, never-participating semantics in every packet', () => {
    const completions = computeStepCompletion(defaultFormData); // nothing else filled in
    for (const packetId of Object.keys(PACKETS)) {
      const packet = getPacket(packetId)!;
      const reviewStep = packet.steps.find((s) => s.type === 'review');
      expect(reviewStep).toBeDefined(); // every packet ends with one
      expect(completions[reviewStep!.id]).toEqual({ step: 'review', completed: 1, total: 1, percent: 100 });
      // Despite review always reporting itself "complete," it never
      // inflates an otherwise-empty applicant's overall percentage.
      expect(computeOverallCompletion(packet, defaultFormData)).toBe(0);
    }
  });
});
