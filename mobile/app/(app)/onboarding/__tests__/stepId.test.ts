import { REAL_STEP_SCREENS } from '../[stepId]';
import { getPacket, computeStepCompletion, defaultFormData, PACKETS } from '@pcs/shared';
import PersonalInfoScreen from '../../../../src/features/onboarding/PersonalInfoScreen';
import EmploymentApplicationScreen from '../../../../src/features/onboarding/EmploymentApplicationScreen';
import AcknowledgementScreen from '../../../../src/features/onboarding/AcknowledgementScreen';
import EmploymentReferenceScreen from '../../../../src/features/onboarding/EmploymentReferenceScreen';
import W4Screen from '../../../../src/features/onboarding/W4Screen';
import I9Screen from '../../../../src/features/onboarding/I9Screen';
import VaccineDeclinationScreen from '../../../../src/features/onboarding/VaccineDeclinationScreen';
import DirectDepositScreen from '../../../../src/features/onboarding/DirectDepositScreen';
import DocumentsScreen from '../../../../src/features/onboarding/DocumentsScreen';
import SafetyAcknowledgementsScreen from '../../../../src/features/onboarding/SafetyAcknowledgementsScreen';
import ReviewScreen from '../../../../src/features/onboarding/ReviewScreen';

// Verifies the routing registry directly (which step ids map to a real
// screen vs. fall through to the placeholder) without a full navigator
// render — consistent with this project's stated avoidance of
// snapshot/full-render screen tests (jest.config.js), while still directly
// exercising the actual behavior M6 §13 asks for.
describe('onboarding [stepId] real-screen registry', () => {
  it('maps personal_info to the real Personal Information screen', () => {
    expect(REAL_STEP_SCREENS.personal_info).toBe(PersonalInfoScreen);
  });

  it('maps employment_application to the real Employment Application screen', () => {
    expect(REAL_STEP_SCREENS.employment_application).toBe(EmploymentApplicationScreen);
  });

  it('maps application_statement, background_auth, health_info_auth, patient_bill_of_rights, AND jcaho_review to the same real AcknowledgementScreen', () => {
    expect(REAL_STEP_SCREENS.application_statement).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.background_auth).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.health_info_auth).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.patient_bill_of_rights).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.jcaho_review).toBe(AcknowledgementScreen);
  });

  it('maps w4 to the real W4Screen', () => {
    expect(REAL_STEP_SCREENS.w4).toBe(W4Screen);
  });

  it('maps i9 to the real I9Screen', () => {
    expect(REAL_STEP_SCREENS.i9).toBe(I9Screen);
  });

  it('maps hep_b_declination to the real VaccineDeclinationScreen', () => {
    expect(REAL_STEP_SCREENS.hep_b_declination).toBe(VaccineDeclinationScreen);
  });

  it('maps direct_deposit to the real DirectDepositScreen', () => {
    expect(REAL_STEP_SCREENS.direct_deposit).toBe(DirectDepositScreen);
  });

  it('maps tdap_declination to the same real VaccineDeclinationScreen as hep_b_declination', () => {
    expect(REAL_STEP_SCREENS.tdap_declination).toBe(VaccineDeclinationScreen);
  });

  it('maps flu_declination to the same real VaccineDeclinationScreen as hep_b_declination/tdap_declination', () => {
    expect(REAL_STEP_SCREENS.flu_declination).toBe(VaccineDeclinationScreen);
  });

  it('maps documents to the real DocumentsScreen', () => {
    expect(REAL_STEP_SCREENS.documents).toBe(DocumentsScreen);
  });

  it('maps safety_acknowledgements to the real SafetyAcknowledgementsScreen', () => {
    expect(REAL_STEP_SCREENS.safety_acknowledgements).toBe(SafetyAcknowledgementsScreen);
  });

  it('maps review to the real ReviewScreen, for every packet', () => {
    expect(REAL_STEP_SCREENS.review).toBe(ReviewScreen);
  });

  it('maps employment_ref_1, employment_ref_2, AND employment_ref_3 to the same real Employment Reference screen', () => {
    expect(REAL_STEP_SCREENS.employment_ref_1).toBe(EmploymentReferenceScreen);
    expect(REAL_STEP_SCREENS.employment_ref_2).toBe(EmploymentReferenceScreen);
    expect(REAL_STEP_SCREENS.employment_ref_3).toBe(EmploymentReferenceScreen);
  });

  it('leaves the one genuinely unimplemented step (the OPTIONAL safety_exam) as an honest placeholder', () => {
    // M16 wires in jcaho_review and review (every packet's required, final
    // "Review & Submit" step, now a real submission boundary — see
    // ADR-029). safety_exam (General RN/LVN's OPTIONAL "Clinical
    // Competency Exam" — required: false, a different step entirely from
    // safety_acknowledgements' own "Safety & Education Exam" label) is the
    // one remaining unimplemented step, deliberately: it never blocks
    // Review or submission (required: false, filtered out by
    // resolveNextRequiredStep/isPacketComplete already), and no quiz
    // content/scoring was invented for it.
    expect(REAL_STEP_SCREENS.safety_exam).toBeUndefined();
  });

  it('keeps the real packet order intact regardless of implementation history (employment_ref_1 stays after employment_application)', () => {
    const packet = getPacket('general_rn');
    const ids = packet!.steps.map((s) => s.id);
    expect(ids.indexOf('personal_info')).toBeLessThan(ids.indexOf('employment_application'));
    expect(ids.indexOf('employment_application')).toBeLessThan(ids.indexOf('application_statement'));
    expect(ids.indexOf('application_statement')).toBeLessThan(ids.indexOf('employment_ref_1'));
  });

  it('confirms employment_ref_2 is required (not a packet branch) in every packet type — the actual source, not an assumed matrix', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId);
      const ref2 = packet!.steps.find((s) => s.id === 'employment_ref_2');
      expect(ref2).toBeDefined();
      expect(ref2!.required).toBe(true);
      // Reference #2 always comes before Background Authorization, and Reference #1
      // always comes before Reference #2, in every packet — no branch exists here.
      const ids = packet!.steps.map((s) => s.id);
      expect(ids.indexOf('employment_ref_1')).toBeLessThan(ids.indexOf('employment_ref_2'));
      expect(ids.indexOf('employment_ref_2')).toBeLessThan(ids.indexOf('background_auth'));
    }
  });

  it('confirms employment_ref_3 is travel_rn-only and genuinely optional (M10)', () => {
    expect(getPacket('travel_rn')!.steps.find((s) => s.id === 'employment_ref_3')?.required).toBe(false);
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn']) {
      expect(getPacket(packetId)!.steps.find((s) => s.id === 'employment_ref_3')).toBeUndefined();
    }
  });

  it('confirms the real M11 branch: health_info_auth exists ONLY for general_rn/lvn, w4 is icu/er/travel\'s immediate next step after background_auth', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const ids = getPacket(packetId)!.steps.map((s) => s.id);
      expect(ids).toContain('health_info_auth');
      expect(ids.indexOf('background_auth')).toBeLessThan(ids.indexOf('health_info_auth'));
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      expect(packet.steps.find((s) => s.id === 'health_info_auth')).toBeUndefined();
      const backgroundIdx = packet.steps.findIndex((s) => s.id === 'background_auth');
      const w4Idx = packet.steps.findIndex((s) => s.id === 'w4');
      // w4 is the very next step after background_auth for these packets —
      // no other required step sits between them.
      expect(w4Idx).toBe(backgroundIdx + 1);
    }
  });

  it('confirms the real M12 branch: patient_bill_of_rights is General RN/LVN\'s immediate next step after health_info_auth; i9 is ICU/ER/Travel\'s immediate next step after w4', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const healthIdx = packet.steps.findIndex((s) => s.id === 'health_info_auth');
      const pborIdx = packet.steps.findIndex((s) => s.id === 'patient_bill_of_rights');
      expect(pborIdx).toBe(healthIdx + 1);
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      expect(packet.steps.find((s) => s.id === 'patient_bill_of_rights')).toBeUndefined();
      const w4Idx = packet.steps.findIndex((s) => s.id === 'w4');
      const i9Idx = packet.steps.findIndex((s) => s.id === 'i9');
      expect(i9Idx).toBe(w4Idx + 1);
    }
  });

  it('confirms the real M13 branch: hep_b_declination exists ONLY for general_rn/lvn, immediately after patient_bill_of_rights — NOT after i9 as the original milestone framing assumed', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const pborIdx = packet.steps.findIndex((s) => s.id === 'patient_bill_of_rights');
      const hepBIdx = packet.steps.findIndex((s) => s.id === 'hep_b_declination');
      expect(hepBIdx).toBe(pborIdx + 1);
      // tdap/flu declinations immediately follow, ahead of w4/i9 — none of
      // the three are implemented except hep_b_declination (M13 §"earliest
      // missing step only").
      expect(packet.steps[hepBIdx + 1].id).toBe('tdap_declination');
      expect(packet.steps[hepBIdx + 2].id).toBe('flu_declination');
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      expect(packet.steps.find((s) => s.id === 'hep_b_declination')).toBeUndefined();
      expect(packet.steps.find((s) => s.id === 'tdap_declination')).toBeUndefined();
      expect(packet.steps.find((s) => s.id === 'flu_declination')).toBeUndefined();
    }
  });

  it('confirms the real M13 finding: direct_deposit exists in EVERY packet, always immediately after i9 — not exclusive to ICU/ER/Travel as the original milestone framing assumed', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      const i9Idx = packet.steps.findIndex((s) => s.id === 'i9');
      const ddIdx = packet.steps.findIndex((s) => s.id === 'direct_deposit');
      expect(i9Idx).toBeGreaterThanOrEqual(0);
      expect(ddIdx).toBe(i9Idx + 1);
      // `documents` is always the very next step after direct_deposit, in
      // every packet — now a real screen, confirmed above.
      expect(packet.steps[ddIdx + 1].id).toBe('documents');
    }
  });

  it('confirms the real M14 branch: tdap_declination is General RN/LVN\'s immediate next step after hep_b_declination — the expected split, fresh from source', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const hepBIdx = packet.steps.findIndex((s) => s.id === 'hep_b_declination');
      const tdapIdx = packet.steps.findIndex((s) => s.id === 'tdap_declination');
      expect(tdapIdx).toBe(hepBIdx + 1);
      expect(packet.steps[tdapIdx].required).toBe(true);
      // flu_declination immediately follows — unregistered as of M14
      // ("earliest missing step only" stopped M14 at tdap_declination);
      // wired in by M15, confirmed in its own describe block below.
      expect(packet.steps[tdapIdx + 1]?.id).toBe('flu_declination');
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      expect(getPacket(packetId)!.steps.find((s) => s.id === 'tdap_declination')).toBeUndefined();
    }
  });

  it('confirms the real M14 branch: documents\' actual required document set is identical across every packet (i9Uploads + nursing_license/cpr_cert), not assumed', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      const documentsStep = packet.steps.find((s) => s.id === 'documents')!;
      expect(documentsStep.required).toBe(true);
      expect(documentsStep.config?.i9Uploads).toBe(true);
      expect(documentsStep.config?.requiredUploads).toEqual(['nursing_license', 'cpr_cert']);
    }
  });

  it('packet-driven routing keeps TDAP and Documents from leaking into the wrong branch — General RN/LVN never see documents before their own vaccine declinations finish', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const ids = packet.steps.map((s) => s.id);
      expect(ids.indexOf('tdap_declination')).toBeLessThan(ids.indexOf('documents'));
    }
    // ICU/ER/Travel have no vaccine declination steps at all — confirmed
    // already above — so there is nothing for them to see "early."
  });

  it('confirms the real M15 branch: flu_declination is General RN/LVN\'s immediate next step after tdap_declination, and its own next step is w4', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const tdapIdx = packet.steps.findIndex((s) => s.id === 'tdap_declination');
      const fluIdx = packet.steps.findIndex((s) => s.id === 'flu_declination');
      expect(fluIdx).toBe(tdapIdx + 1);
      expect(packet.steps[fluIdx].required).toBe(true);
      expect(packet.steps[fluIdx + 1]?.id).toBe('w4');
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      expect(getPacket(packetId)!.steps.find((s) => s.id === 'flu_declination')).toBeUndefined();
    }
  });

  it('confirms the real M15 branch: safety_acknowledgements is ICU/ER/Travel\'s immediate next step after documents, with review immediately after it — no safety_exam/jcaho_review for these packets', () => {
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      const documentsIdx = packet.steps.findIndex((s) => s.id === 'documents');
      const safetyIdx = packet.steps.findIndex((s) => s.id === 'safety_acknowledgements');
      expect(safetyIdx).toBe(documentsIdx + 1);
      expect(packet.steps[safetyIdx].required).toBe(true);
      expect(packet.steps[safetyIdx + 1]?.id).toBe('review');
      expect(packet.steps.find((s) => s.id === 'jcaho_review')).toBeUndefined();
      expect(packet.steps.find((s) => s.id === 'safety_exam')).toBeUndefined();
    }
  });

  it('confirms the real M15 branch: General RN/LVN reach safety_acknowledgements via documents -> jcaho_review -> safety_acknowledgements, then an OPTIONAL safety_exam before review', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const packet = getPacket(packetId)!;
      const documentsIdx = packet.steps.findIndex((s) => s.id === 'documents');
      const jcahoIdx = packet.steps.findIndex((s) => s.id === 'jcaho_review');
      const safetyIdx = packet.steps.findIndex((s) => s.id === 'safety_acknowledgements');
      const examIdx = packet.steps.findIndex((s) => s.id === 'safety_exam');
      const reviewIdx = packet.steps.findIndex((s) => s.id === 'review');
      expect(jcahoIdx).toBe(documentsIdx + 1);
      expect(safetyIdx).toBe(jcahoIdx + 1);
      expect(packet.steps[safetyIdx].required).toBe(true);
      // safety_exam sits between safety_acknowledgements and review, but is
      // NOT required — it must never block reaching review.
      expect(examIdx).toBe(safetyIdx + 1);
      expect(packet.steps[examIdx].required).toBe(false);
      expect(reviewIdx).toBe(examIdx + 1);
    }
  });

  it('safety_acknowledgements has an identical config across every packet — no role variation', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      const step = getPacket(packetId)!.steps.find((s) => s.id === 'safety_acknowledgements')!;
      expect(step.config?.acknowledgementId).toBe('safety_acknowledgements');
      expect(step.config?.requiresSignature).toBe(false);
      expect(step.required).toBe(true);
    }
  });

  it('confirms the real M16 branch: jcaho_review is structurally identical to the other single-checkbox+signature acknowledgements — no hasDeclination, no per-topic structure', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const step = getPacket(packetId)!.steps.find((s) => s.id === 'jcaho_review')!;
      expect(step.type).toBe('acknowledgement');
      expect(step.config?.acknowledgementId).toBe('jcaho_review');
      expect(step.config?.requiresSignature).toBe(true);
      expect(step.config?.hasDeclination).toBeUndefined();
      expect(step.required).toBe(true);
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      expect(getPacket(packetId)!.steps.find((s) => s.id === 'jcaho_review')).toBeUndefined();
    }
  });

  it('confirms `review` is every packet\'s final step, required, and reachable', () => {
    for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
      const packet = getPacket(packetId)!;
      const lastStep = packet.steps[packet.steps.length - 1];
      expect(lastStep.id).toBe('review');
      expect(lastStep.type).toBe('review');
      expect(lastStep.required).toBe(true);
      expect(REAL_STEP_SCREENS[lastStep.id]).toBe(ReviewScreen);
    }
  });

  /**
   * M16 §42 — the capstone coverage invariant. After this milestone, the
   * complete REQUIRED applicant packet should be provably implemented: not
   * asserted from memory of what's been built milestone-by-milestone, but
   * checked directly against the real packet definitions, the real shared
   * completion evaluators, and the real mobile screen registry, for every
   * packet that exists today. A future packet addition with a required
   * step missing either piece fails this test instead of silently shipping
   * as an unreachable or uncompletable placeholder.
   */
  describe('M16 — required-implementation-coverage invariant', () => {
    it('every REQUIRED, non-review step in every current packet has BOTH a completion evaluator AND a real mobile screen', () => {
      const completions = computeStepCompletion(defaultFormData);
      const missingEvaluator: string[] = [];
      const missingScreen: string[] = [];

      for (const packetId of Object.keys(PACKETS)) {
        const packet = getPacket(packetId)!;
        for (const step of packet.steps) {
          if (!step.required || step.type === 'review') continue;
          if (completions[step.id] === undefined) missingEvaluator.push(`${packetId}:${step.id}`);
          if (!REAL_STEP_SCREENS[step.id]) missingScreen.push(`${packetId}:${step.id}`);
        }
      }

      expect(missingEvaluator).toEqual([]);
      expect(missingScreen).toEqual([]);
    });

    it('`review` itself is routable in every packet (a completion evaluator is not expected — see completion.ts\'s own always-complete review semantics)', () => {
      for (const packetId of Object.keys(PACKETS)) {
        const packet = getPacket(packetId)!;
        const reviewStep = packet.steps.find((s) => s.type === 'review')!;
        expect(REAL_STEP_SCREENS[reviewStep.id]).toBe(ReviewScreen);
      }
    });

    it('the one intentionally unimplemented step is OPTIONAL (safety_exam) — every other packet step, required or not, that has mobile relevance is accounted for', () => {
      const unimplementedRequired: string[] = [];
      for (const packetId of Object.keys(PACKETS)) {
        const packet = getPacket(packetId)!;
        for (const step of packet.steps) {
          if (!REAL_STEP_SCREENS[step.id] && step.required) unimplementedRequired.push(`${packetId}:${step.id}`);
        }
      }
      expect(unimplementedRequired).toEqual([]);
    });
  });
});
