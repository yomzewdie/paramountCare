import { REAL_STEP_SCREENS } from '../[stepId]';
import { getPacket } from '@pcs/shared';
import PersonalInfoScreen from '../../../../src/features/onboarding/PersonalInfoScreen';
import EmploymentApplicationScreen from '../../../../src/features/onboarding/EmploymentApplicationScreen';
import ApplicationStatementScreen from '../../../../src/features/onboarding/ApplicationStatementScreen';
import EmploymentReferenceScreen from '../../../../src/features/onboarding/EmploymentReferenceScreen';

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

  it('maps application_statement to the real Application Statement screen', () => {
    expect(REAL_STEP_SCREENS.application_statement).toBe(ApplicationStatementScreen);
  });

  it('maps employment_ref_1 AND employment_ref_2 to the same real Employment Reference screen', () => {
    expect(REAL_STEP_SCREENS.employment_ref_1).toBe(EmploymentReferenceScreen);
    expect(REAL_STEP_SCREENS.employment_ref_2).toBe(EmploymentReferenceScreen);
  });

  it('leaves the optional third reference instance and unmigrated steps as honest placeholders', () => {
    expect(REAL_STEP_SCREENS.background_auth).toBeUndefined();
    expect(REAL_STEP_SCREENS.employment_ref_3).toBeUndefined();
    expect(REAL_STEP_SCREENS.w4).toBeUndefined();
    expect(REAL_STEP_SCREENS.i9).toBeUndefined();
    expect(REAL_STEP_SCREENS.documents).toBeUndefined();
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
});
