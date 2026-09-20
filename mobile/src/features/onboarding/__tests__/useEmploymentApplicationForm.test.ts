import { renderHook, act } from '@testing-library/react-native';
import { defaultFormData } from '@pcs/shared';
import { useEmploymentApplicationForm } from '../useEmploymentApplicationForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = useSession as jest.Mock;

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 5,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    stepStates: {},
    formData: {},
    status: 'active',
    applicationId: null,
    revision: 1,
    completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SessionResponse;
}

const VALID_APPLICATION = {
  ...defaultFormData.employmentApplication,
  positionApplied: 'RN — Med/Surg',
  specialtyPreference: 'Med-Surg',
  shiftPreference: 'day',
  employmentType: 'full_time',
  licenseType: 'RN',
  licenseNumber: 'RN123456',
  licenseState: 'CA',
  licenseExpiration: '2027-01-01',
  yearsExperience: '3-5',
  primarySpecialty: 'Med-Surg',
  authorizedToWork: true,
  hasConviction: false,
  hasLicenseDiscipline: false,
  hasLicenseRevocation: false,
  underInvestigation: false,
  emergencyContactName: 'Jane Smith',
  emergencyContactRelationship: 'Spouse',
  emergencyContactPhone: '555-000-1111',
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useEmploymentApplicationForm — loading', () => {
  it('populates fields from the session\'s existing employmentApplication', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'RN' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data.positionApplied).toBe('RN');
  });

  it('defaults to the shared empty shape when the session has no employmentApplication yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.data).toEqual(defaultFormData.employmentApplication);
  });

  it('shows no errors on load even though required fields are empty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());
    expect(result.current.errors).toEqual({});
  });
});

describe('useEmploymentApplicationForm — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    expect(result.current.errors.positionApplied).toBeUndefined();
    act(() => result.current.blurField('positionApplied'));
    expect(result.current.errors.positionApplied).toBeTruthy();
  });

  it('requires authorizedToWork to be true, not merely answered', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, authorizedToWork: false } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('authorizedToWork'));
    expect(result.current.errors.authorizedToWork).toBeTruthy();
  });

  it('requires convictionDetails only when hasConviction is true (conditional field)', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasConviction: true, convictionDetails: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('convictionDetails'));
    expect(result.current.errors.convictionDetails).toBeTruthy();
  });

  it('does not require convictionDetails when hasConviction is false', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasConviction: false, convictionDetails: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('convictionDetails'));
    expect(result.current.errors.convictionDetails).toBeUndefined();
  });

  it('does not require hasCPR detail fields even when hasCPR is true (matches the real validator — no such rule exists)', () => {
    setupSession(fakeSession({ formData: { employmentApplication: { ...VALID_APPLICATION, hasCPR: true, cprCertNumber: '', cprExpiration: '' } } }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.blurField('cprCertNumber'));
    act(() => result.current.blurField('cprExpiration'));
    expect(result.current.errors.cprCertNumber).toBeUndefined();
    expect(result.current.errors.cprExpiration).toBeUndefined();
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.positionApplied).toBeTruthy();
    expect(result.current.errors.authorizedToWork).toBeTruthy();
    expect(result.current.errors.emergencyContactName).toBeTruthy();
  });
});

describe('useEmploymentApplicationForm — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {}, stepStates: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'RN')); // rest still invalid/empty
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ formDataKey: 'employmentApplication', stepId: 'employment_application', status: 'in_progress' }),
    );
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { employment_application: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe('useEmploymentApplicationForm — complete', () => {
  it('saves with status "completed" once all required fields (including conditional ones) are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepData: VALID_APPLICATION }));
  });
});

describe('useEmploymentApplicationForm — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server value, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.positionApplied).toBe('ServerWon');
    expect(result.current.data.positionApplied).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('keepMyChanges dismisses the conflict without altering the form data', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.keepMyChanges());

    expect(result.current.conflict).toBeNull();
    expect(result.current.data.positionApplied).toBe('MyOwnEdit');
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values and clears dirty state', async () => {
    const latestSession = fakeSession({ formData: { employmentApplication: { ...defaultFormData.employmentApplication, positionApplied: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());
    act(() => result.current.setField('positionApplied', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.positionApplied).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('useEmploymentApplicationForm — network/server error', () => {
  it('surfaces the error message without touching local data', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_APPLICATION);
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});

describe('useEmploymentApplicationForm — server validation rejection (defense-in-depth)', () => {
  it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.saveError).toBeNull();
    expect(result.current.errors.positionApplied).toBeDefined();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
    setupSession(
      fakeSession({ formData: { employmentApplication: VALID_APPLICATION } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentApplicationForm());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
    expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
  });
});
