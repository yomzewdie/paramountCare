import { REAL_STEP_SCREENS } from '../[stepId]';
import { getPacket } from '@pcs/shared';
import PersonalInfoScreen from '../../../../src/features/onboarding/PersonalInfoScreen';
import EmploymentApplicationScreen from '../../../../src/features/onboarding/EmploymentApplicationScreen';
import AcknowledgementScreen from '../../../../src/features/onboarding/AcknowledgementScreen';
import EmploymentReferenceScreen from '../../../../src/features/onboarding/EmploymentReferenceScreen';
import W4Screen from '../../../../src/features/onboarding/W4Screen';
import I9Screen from '../../../../src/features/onboarding/I9Screen';
import VaccineDeclinationScreen from '../../../../src/features/onboarding/VaccineDeclinationScreen';
import DirectDepositScreen from '../../../../src/features/onboarding/DirectDepositScreen';

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

  it('maps application_statement, background_auth, health_info_auth, AND patient_bill_of_rights to the same real AcknowledgementScreen', () => {
    expect(REAL_STEP_SCREENS.application_statement).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.background_auth).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.health_info_auth).toBe(AcknowledgementScreen);
    expect(REAL_STEP_SCREENS.patient_bill_of_rights).toBe(AcknowledgementScreen);
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

  it('maps employment_ref_1, employment_ref_2, AND employment_ref_3 to the same real Employment Reference screen', () => {
    expect(REAL_STEP_SCREENS.employment_ref_1).toBe(EmploymentReferenceScreen);
    expect(REAL_STEP_SCREENS.employment_ref_2).toBe(EmploymentReferenceScreen);
    expect(REAL_STEP_SCREENS.employment_ref_3).toBe(EmploymentReferenceScreen);
  });

  it('leaves genuinely unmigrated steps as honest placeholders', () => {
    // tdap_declination/flu_declination reuse the exact same
    // VaccineDeclinationScreen model as hep_b_declination once their own
    // VACCINE_META copy is confirmed and added — "earliest missing step
    // only" means M13 registers hep_b_declination alone. documents is the
    // step immediately after direct_deposit in every packet and has no
    // mobile implementation at all yet (see DirectDepositScreen's own
    // voided-check upload, which is Direct-Deposit-specific, not this
    // step's later credential-upload experience).
    expect(REAL_STEP_SCREENS.tdap_declination).toBeUndefined();
    expect(REAL_STEP_SCREENS.flu_declination).toBeUndefined();
    expect(REAL_STEP_SCREENS.documents).toBeUndefined();
    expect(REAL_STEP_SCREENS.jcaho_review).toBeUndefined();
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
      // `documents` (still an honest placeholder — see above) is always the
      // very next step after direct_deposit, in every packet.
      expect(packet.steps[ddIdx + 1].id).toBe('documents');
    }
  });
});
