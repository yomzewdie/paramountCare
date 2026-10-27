import { renderHook, act } from '@testing-library/react-native';
import { useReviewSubmission } from '../useReviewSubmission';
import { useSession } from '../SessionContext';
import type { SubmitResult } from '../SessionContext';
import { deriveProgress, type OnboardingProgress, type StepDisplayItem } from '../steps';
import { defaultEmploymentReference, defaultFormData } from '@pcs/shared';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = useSession as jest.Mock;

function step(id: string, completed: boolean, required = true): StepDisplayItem {
  return { id, label: id, completed, required };
}

function fakeProgress(steps: StepDisplayItem[]): OnboardingProgress {
  return {
    packetName: 'ICU RN',
    steps,
    completedSteps: steps.filter((s) => s.completed),
    remainingSteps: steps.filter((s) => !s.completed),
    nextStep: null,
    isComplete: false,
  };
}

function setup(progress: OnboardingProgress | null, submitApplicationImpl?: jest.Mock, sessionOverrides: Record<string, unknown> = {}) {
  const submitApplication = submitApplicationImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({
    session: { sessionId: 's1', status: 'active', applicationId: null, ...sessionOverrides },
    progress,
    submitApplication,
    status: 'ready',
    error: null,
    refresh: jest.fn(),
  });
  return submitApplication;
}

beforeEach(() => jest.clearAllMocks());

/**
 * M16 (ADR-029). The core thing this hook must get right: `readyToSubmit`
 * is NOT the same as `progress.isComplete` — that flag requires `review`
 * itself to already be 'completed', which can never be true before a
 * first successful submission. See the hook's own doc comment.
 */
describe('useReviewSubmission', () => {
  describe('readiness', () => {
    it('is ready once every required, non-review step is completed — even though review itself is not', () => {
      setup(fakeProgress([
        step('personal_info', true),
        step('documents', true),
        step('safety_acknowledgements', true),
        step('review', false), // review is never "completed" pre-submission
      ]));
      const { result } = renderHook(() => useReviewSubmission());
      expect(result.current.readyToSubmit).toBe(true);
      expect(result.current.incompleteRequiredSteps).toEqual([]);
    });

    it('is NOT ready when a required step is incomplete, and lists it', () => {
      setup(fakeProgress([
        step('personal_info', true),
        step('documents', false),
        step('review', false),
      ]));
      const { result } = renderHook(() => useReviewSubmission());
      expect(result.current.readyToSubmit).toBe(false);
      expect(result.current.incompleteRequiredSteps.map((s) => s.id)).toEqual(['documents']);
    });

    it('never lists an OPTIONAL incomplete step (e.g. safety_exam) among incompleteRequiredSteps', () => {
      setup(fakeProgress([
        step('personal_info', true),
        step('safety_exam', false, false),
        step('review', false),
      ]));
      const { result } = renderHook(() => useReviewSubmission());
      expect(result.current.readyToSubmit).toBe(true);
      expect(result.current.optionalSteps.map((s) => s.id)).toEqual(['safety_exam']);
    });
  });

  describe('submit()', () => {
    it('blocks locally (never calls the API) when a required step is incomplete', async () => {
      const submitApplication = setup(fakeProgress([step('documents', false), step('review', false)]));
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(outcome).toEqual({ kind: 'incomplete', incompleteSteps: [{ id: 'documents', label: 'documents' }] });
      expect(submitApplication).not.toHaveBeenCalled();
    });

    it('calls the real submission endpoint when ready, and reports success', async () => {
      const submitApplication = setup(
        fakeProgress([step('personal_info', true), step('review', false)]),
        jest.fn().mockResolvedValue({ status: 'submitted', data: { applicationId: 'PCS-2026-ABCD', submittedAt: '2026-01-01T00:00:00.000Z', alreadySubmitted: false } } satisfies SubmitResult),
      );
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(submitApplication).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ kind: 'submitted', applicationId: 'PCS-2026-ABCD', alreadySubmitted: false });
    });

    it('surfaces a server-side conflict (a required field changed elsewhere) distinctly from a client-side incomplete block', async () => {
      const latestSession = { sessionId: 's1', revision: 3 } as never;
      setup(
        fakeProgress([step('personal_info', true), step('review', false)]),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SubmitResult),
      );
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict).toBe(true);
    });

    it('surfaces a server-side incomplete rejection (client thought it was ready, server disagreed) with the server\'s own list', async () => {
      setup(
        fakeProgress([step('personal_info', true), step('review', false)]),
        jest.fn().mockResolvedValue({ status: 'incomplete', incompleteSteps: [{ id: 'w4', label: 'Tax Forms / W-4' }] } satisfies SubmitResult),
      );
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(outcome).toEqual({ kind: 'incomplete', incompleteSteps: [{ id: 'w4', label: 'Tax Forms / W-4' }] });
      expect(result.current.incompleteSteps).toEqual([{ id: 'w4', label: 'Tax Forms / W-4' }]);
    });

    it('surfaces a generic error honestly', async () => {
      setup(
        fakeProgress([step('personal_info', true), step('review', false)]),
        jest.fn().mockResolvedValue({ status: 'error', error: { code: 'server_error', message: 'Something went wrong.' } } satisfies SubmitResult),
      );
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(outcome).toEqual({ kind: 'error', message: 'Something went wrong.' });
      expect(result.current.submitError).toBe('Something went wrong.');
    });

    it('treats an idempotent "already submitted" success identically to a fresh submission', async () => {
      setup(
        fakeProgress([step('personal_info', true), step('review', false)]),
        jest.fn().mockResolvedValue({ status: 'submitted', data: { applicationId: 'PCS-2026-ABCD', submittedAt: null, alreadySubmitted: true } } satisfies SubmitResult),
      );
      const { result } = renderHook(() => useReviewSubmission());

      let outcome;
      await act(async () => { outcome = await result.current.submit(); });

      expect(outcome).toEqual({ kind: 'submitted', applicationId: 'PCS-2026-ABCD', alreadySubmitted: true });
    });
  });

  describe('isSubmitted', () => {
    it('reflects session.status === "submitted"', () => {
      setup(fakeProgress([]), undefined, { status: 'submitted', applicationId: 'PCS-2026-ABCD' });
      const { result } = renderHook(() => useReviewSubmission());
      expect(result.current.isSubmitted).toBe(true);
      expect(result.current.applicationId).toBe('PCS-2026-ABCD');
    });
  });
});

// UAT follow-up: a step stored as 'completed' under the pre-UAT rules must
// not show as complete on Review (the Worker's submit re-validates it).
describe('useReviewSubmission — steps completed under older rules', () => {
  const VALID_APPLICATION = {
    ...defaultFormData.employmentApplication,
    positionApplied: 'RN', specialtyPreference: ['icu'], shiftPreference: ['am'], employmentType: ['per_diem_assignment'],
    licenseType: 'RN', licenseNumber: 'RN1', licenseState: 'CA', licenseExpiration: '2028-03-15',
    yearsExperience: '3-5', primarySpecialty: 'icu',
    authorizedToWork: true, hasConviction: false, hasLicenseDiscipline: false, hasLicenseRevocation: false, underInvestigation: false,
    emergencyContactName: 'Jane', emergencyContactRelationship: 'Spouse', emergencyContactPhone: '555-000-1111',
  };
  const LEGACY_APPLICATION = {
    ...VALID_APPLICATION,
    positionApplied: 'RN — Med/Surg', specialtyPreference: 'Med-Surg', shiftPreference: 'day', employmentType: 'full_time',
  };
  const VALID_REFERENCE = {
    ...defaultEmploymentReference,
    positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
    employerName: 'Hospital', employerCity: 'LA', employerState: 'CA',
    supervisorName: 'Pat', supervisorPhone: '555-000-1111', supervisorTitle: 'Nurse Manager',
    permissionGranted: true, eligibleForRehire: true,
  };
  const { supervisorTitle: _omit, ...referenceWithoutTitle } = VALID_REFERENCE;
  const LEGACY_REFERENCE = { ...referenceWithoutTitle, reasonForLeaving: 'Relocation' };

  const STEP_STATES = { personal_info: 'completed', employment_application: 'completed', employment_ref_1: 'completed' };

  function setupReal(formData: Record<string, unknown>) {
    const session = { sessionId: 's1', packetId: 'general_rn', status: 'active', applicationId: null, stepStates: STEP_STATES, formData };
    mockedUseSession.mockReturnValue({
      session,
      progress: deriveProgress('general_rn', STEP_STATES, formData),
      submitApplication: jest.fn(),
      status: 'ready',
      error: null,
      refresh: jest.fn(),
    });
    return session;
  }
  const completedOf = (steps: StepDisplayItem[], id: string) => steps.find((s) => s.id === id)?.completed;

  it('a legacy Employment Application stored as completed is NOT complete on Review', () => {
    setupReal({ employmentApplication: LEGACY_APPLICATION, employmentReferences: { employment_ref_1: VALID_REFERENCE } });
    const { result } = renderHook(() => useReviewSubmission());
    expect(completedOf(result.current.steps, 'employment_application')).toBe(false);
    expect(completedOf(result.current.steps, 'employment_ref_1')).toBe(true);
    expect(result.current.incompleteRequiredSteps.map((s) => s.id)).toContain('employment_application');
    expect(result.current.readyToSubmit).toBe(false);
  });

  it('a legacy Employment Reference without supervisorTitle stored as completed is NOT complete on Review', () => {
    setupReal({ employmentApplication: VALID_APPLICATION, employmentReferences: { employment_ref_1: LEGACY_REFERENCE } });
    const { result } = renderHook(() => useReviewSubmission());
    expect(completedOf(result.current.steps, 'employment_ref_1')).toBe(false);
    expect(completedOf(result.current.steps, 'employment_application')).toBe(true);
    expect(result.current.incompleteRequiredSteps.map((s) => s.id)).toContain('employment_ref_1');
  });

  it('once fixed and saved, both steps show complete again', () => {
    setupReal({ employmentApplication: VALID_APPLICATION, employmentReferences: { employment_ref_1: VALID_REFERENCE } });
    const { result } = renderHook(() => useReviewSubmission());
    expect(completedOf(result.current.steps, 'employment_application')).toBe(true);
    expect(completedOf(result.current.steps, 'employment_ref_1')).toBe(true);
    expect(result.current.incompleteRequiredSteps.map((s) => s.id)).not.toContain('employment_application');
    expect(result.current.incompleteRequiredSteps.map((s) => s.id)).not.toContain('employment_ref_1');
  });

  it('never alters the stored session data or step statuses', () => {
    const session = setupReal({ employmentApplication: LEGACY_APPLICATION, employmentReferences: { employment_ref_1: LEGACY_REFERENCE } });
    const before = JSON.stringify(session);
    renderHook(() => useReviewSubmission());
    expect(JSON.stringify(session)).toBe(before);
  });

  it('submit() is blocked locally and lists the legacy steps, without calling the Worker', async () => {
    setupReal({ employmentApplication: LEGACY_APPLICATION, employmentReferences: { employment_ref_1: LEGACY_REFERENCE } });
    const { result } = renderHook(() => useReviewSubmission());
    let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => { outcome = await result.current.submit(); });
    expect(outcome?.kind).toBe('incomplete');
    const ids = outcome?.kind === 'incomplete' ? outcome.incompleteSteps.map((s) => s.id) : [];
    expect(ids).toEqual(expect.arrayContaining(['employment_application', 'employment_ref_1']));
    expect(mockedUseSession.mock.results[0].value.submitApplication).not.toHaveBeenCalled();
  });
});
