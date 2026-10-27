import { readFileSync } from 'fs';
import { join } from 'path';
import { renderHook, act } from '@testing-library/react-native';
import { defaultFormData } from '@pcs/shared';
import { deriveProgress, type OnboardingProgress } from '../steps';
import { decideStepExit, nextStepInPhase, useStepNavigation } from '../stepNavigation';
import { findCurrentPhaseId, groupStepsIntoPhases } from '../phases';
import { useSession } from '../SessionContext';
import { usePersonalInfoForm } from '../usePersonalInfoForm';
import { useReviewSubmission } from '../useReviewSubmission';
import type { SessionResponse } from '../sessionApi';

// Physical-UAT regression: after the resume was uploaded, completing a step
// in "Applicant Details & References" navigated BACK to "Upload Your Resume".
// Cause: every step exited with router.back(), which popped a stale Resume
// screen left in the Onboarding tab's stack. Exits are now explicit
// (stepNavigation.ts): Continue goes forward within the phase.

const mockRouter = { replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissAll: jest.fn(), canDismiss: jest.fn(() => true), push: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../../auth/AuthContext', () => ({ useOptionalAuth: jest.fn(() => null) }));

const mockedUseSession = useSession as jest.Mock;

const RESUME = { name: 'resume.pdf', size: 100, type: 'application/pdf', objectKey: 'uploads/1/x-resume.pdf', uploadedAt: '2026-10-01T00:00:00Z' };
const PERSONAL_INFO = {
  ...defaultFormData.personalInfo, firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01', email: 'jane@example.com',
  phone: '555-000-1111', address: '123 Main St', city: 'Los Angeles', state: 'CA', zip: '90001',
};

function session(stepStates: Record<string, string>, formData: Record<string, unknown>): SessionResponse {
  return {
    sessionId: 's1', packetId: 'general_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
    stepStates, formData, status: 'active', applicationId: null, revision: 3, completionPercent: 0,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  } as SessionResponse;
}

function progressOf(s: SessionResponse): OnboardingProgress {
  return deriveProgress(s.packetId, s.stepStates, s.formData)!;
}

function provide(s: SessionResponse, extra: Record<string, unknown> = {}) {
  mockedUseSession.mockReturnValue({ session: s, progress: progressOf(s), status: 'ready', error: null, refresh: jest.fn(), ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canDismiss.mockReturnValue(true);
  mockParams = {};
});

describe('regression: completing a step after the resume never navigates back to Resume', () => {
  it('resume complete → complete Personal Information → goes forward to Applicant Details, resume stays complete', async () => {
    // 1. Resume uploaded and its step complete.
    const before = session({ resume: 'completed', personal_info: 'in_progress' }, { resumeDocument: RESUME, personalInfo: PERSONAL_INFO });
    // 3. Personal Information is saved as completed; the server returns the updated session.
    const after = session({ resume: 'completed', personal_info: 'completed' }, { resumeDocument: RESUME, personalInfo: PERSONAL_INFO });
    const saveStep = jest.fn(async () => {
      provide(after, { saveStep });
      return { status: 'saved', session: after };
    });
    provide(before, { saveStep });
    mockParams = { stepId: 'personal_info', origin: 'home' };

    // 2. The applicant is in Applicant Details & References (opened from Home's Continue).
    const { result: form } = renderHook(() => usePersonalInfoForm());
    act(() => form.current.setField('firstName', 'Jane'));
    let outcome;
    await act(async () => { outcome = await form.current.complete(); });
    expect(outcome).toEqual({ kind: 'saved' });

    // 4–5. Continue goes to the next step in the phase — never back to Resume.
    const { result: nav } = renderHook(() => useStepNavigation());
    act(() => nav.current.afterComplete());
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: 'employment_application', origin: 'home' } });
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(JSON.stringify(mockRouter.replace.mock.calls)).not.toContain('"resume"');

    // 6. Resume remains complete. 7. Home progress is correct.
    const progress = progressOf(after);
    expect(progress.steps.find((s) => s.id === 'resume')?.completed).toBe(true);
    expect(progress.nextStep?.id).toBe('employment_application');
    expect(findCurrentPhaseId(groupStepsIntoPhases(progress.steps), progress.nextStep?.id)).toBe('applicant_details');
    expect(progress.completedSteps.map((s) => s.id)).toEqual(['resume', 'personal_info']);
  });

  it('every step in Applicant Details & References moves forward in order, then leaves the phase', () => {
    const states: Record<string, string> = { resume: 'completed' };
    const order = ['personal_info', 'employment_application', 'employment_ref_1', 'employment_ref_2'];
    const visited: string[] = [];
    for (const stepId of order) {
      states[stepId] = 'completed';
      const exit = decideStepExit(deriveProgress('general_rn', states)!.steps, stepId, 'home', true);
      visited.push(exit.kind === 'next' ? exit.stepId : `leave:${exit.to}`);
    }
    expect(visited).toEqual(['employment_application', 'employment_ref_1', 'employment_ref_2', 'leave:home']);
  });

  it('skips a later step that is already complete, and never goes backward or into another phase', () => {
    const steps = deriveProgress('general_rn', { resume: 'completed', employment_application: 'completed' })!.steps;
    expect(nextStepInPhase(steps, 'personal_info')?.id).toBe('employment_ref_1');
    expect(nextStepInPhase(steps, 'resume')).toBeNull(); // Resume is a one-step phase
  });

  it('opened from Review ("Edit"): returns to Review instead of advancing', () => {
    provide(session({ resume: 'completed', personal_info: 'completed' }, { resumeDocument: RESUME }));
    mockParams = { stepId: 'personal_info', origin: 'review' };
    const { result } = renderHook(() => useStepNavigation());
    act(() => result.current.afterComplete());
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('Save Progress / end of phase: clears the step stack and returns to Home (or the Onboarding list)', () => {
    provide(session({ resume: 'completed' }, { resumeDocument: RESUME }));
    mockParams = { stepId: 'personal_info', origin: 'home' };
    const { result, rerender } = renderHook(() => useStepNavigation());
    act(() => result.current.leave());
    expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/(app)/home');
    expect(mockRouter.back).not.toHaveBeenCalled();

    jest.clearAllMocks();
    mockRouter.canDismiss.mockReturnValue(true);
    mockParams = { stepId: 'personal_info', origin: 'onboarding' };
    rerender({});
    act(() => result.current.leave());
    expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });
});

describe('resume removed → Resume is required again', () => {
  it('Home sends the applicant back to Resume and Review lists it as incomplete', () => {
    // Stored step state still says completed, but the resume was removed.
    const removed = session({ resume: 'completed', personal_info: 'completed' }, { resumeDocument: null, personalInfo: PERSONAL_INFO });
    const progress = progressOf(removed);
    expect(progress.steps.find((s) => s.id === 'resume')?.completed).toBe(false);
    expect(progress.nextStep?.id).toBe('resume');
    expect(findCurrentPhaseId(groupStepsIntoPhases(progress.steps), progress.nextStep?.id)).toBe('about_you');

    provide(removed, { submitApplication: jest.fn() });
    const { result } = renderHook(() => useReviewSubmission());
    expect(result.current.readyToSubmit).toBe(false);
    expect(result.current.incompleteRequiredSteps.map((s) => s.id)).toContain('resume');
  });
});

describe('Primary Clinical Specialty is not collected from new applicants', () => {
  it('the Applicant Details screen never renders it (only Specialty / Unit Preference)', () => {
    const source = readFileSync(join(__dirname, '..', 'EmploymentApplicationScreen.tsx'), 'utf8');
    expect(source).not.toMatch(/Primary Clinical Specialty|primarySpecialty/);
    expect(source).toContain('Specialty / Unit Preference');
  });
});
