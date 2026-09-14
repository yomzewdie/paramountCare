import { REAL_STEP_SCREENS } from '../[stepId]';
import PersonalInfoScreen from '../../../../src/features/onboarding/PersonalInfoScreen';
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

  it('maps employment_ref_1 to the real Employment Reference screen', () => {
    expect(REAL_STEP_SCREENS.employment_ref_1).toBe(EmploymentReferenceScreen);
  });

  it('leaves other reference instances and unmigrated steps as honest placeholders', () => {
    expect(REAL_STEP_SCREENS.employment_ref_2).toBeUndefined();
    expect(REAL_STEP_SCREENS.employment_ref_3).toBeUndefined();
    expect(REAL_STEP_SCREENS.w4).toBeUndefined();
    expect(REAL_STEP_SCREENS.i9).toBeUndefined();
    expect(REAL_STEP_SCREENS.documents).toBeUndefined();
  });
});
