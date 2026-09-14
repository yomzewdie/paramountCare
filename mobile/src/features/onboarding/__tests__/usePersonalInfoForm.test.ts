import { renderHook, act } from '@testing-library/react-native';
import { defaultFormData } from '@pcs/shared';
import { usePersonalInfoForm } from '../usePersonalInfoForm';
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

const VALID_PERSONAL_INFO = {
  ...defaultFormData.personalInfo,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-000-1111',
  address: '123 Main St',
  city: 'Los Angeles',
  state: 'CA',
  zip: '90001',
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('usePersonalInfoForm — loading', () => {
  it('populates fields from the session\'s existing personalInfo', () => {
    setupSession(fakeSession({ formData: { personalInfo: { ...defaultFormData.personalInfo, firstName: 'Jane' } } }));
    const { result } = renderHook(() => usePersonalInfoForm());
    expect(result.current.data.firstName).toBe('Jane');
  });

  it('defaults to the shared empty shape when the session has no personalInfo yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => usePersonalInfoForm());
    expect(result.current.data).toEqual(defaultFormData.personalInfo);
  });

  it('shows no errors on load even though required fields are empty — not irritating by default', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => usePersonalInfoForm());
    expect(result.current.errors).toEqual({});
  });
});

describe('usePersonalInfoForm — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => usePersonalInfoForm());

    expect(result.current.errors.firstName).toBeUndefined();
    act(() => result.current.blurField('firstName'));
    expect(result.current.errors.firstName).toBeTruthy();
  });

  it('setField marks the form dirty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => usePersonalInfoForm());

    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setField('firstName', 'Jane'));
    expect(result.current.isDirty).toBe(true);
  });

  it('flags a format error (malformed email) distinctly from a missing-field error, once touched', () => {
    setupSession(fakeSession({ formData: { personalInfo: { ...VALID_PERSONAL_INFO, email: 'not-an-email' } } }));
    const { result } = renderHook(() => usePersonalInfoForm());

    act(() => result.current.blurField('email'));

    expect(result.current.errors.email).toBe('Enter a valid email address');
    // Every other required field is present and valid — no unrelated errors leak in.
    expect(result.current.errors.firstName).toBeUndefined();
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => usePersonalInfoForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.firstName).toBeTruthy();
    expect(result.current.errors.lastName).toBeTruthy();
    expect(result.current.errors.email).toBeTruthy();
  });
});

describe('usePersonalInfoForm — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(fakeSession({ formData: {}, stepStates: {} }), jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult));
    const { result } = renderHook(() => usePersonalInfoForm());

    act(() => result.current.setField('firstName', 'Jane')); // rest of the form still invalid/empty
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ formDataKey: 'personalInfo', stepId: 'personal_info', status: 'in_progress' }),
    );
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { personal_info: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe('usePersonalInfoForm — complete', () => {
  it('saves with status "completed" once all required fields are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { personalInfo: VALID_PERSONAL_INFO } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepData: VALID_PERSONAL_INFO }));
  });
});

describe('usePersonalInfoForm — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server personalInfo, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { personalInfo: { ...defaultFormData.personalInfo, firstName: 'ServerWon' } } });
    const saveStep = setupSession(
      fakeSession({ formData: { personalInfo: VALID_PERSONAL_INFO } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());

    act(() => result.current.setField('firstName', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.firstName).toBe('ServerWon');
    // The applicant's own in-progress edit is NOT silently overwritten.
    expect(result.current.data.firstName).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('keepMyChanges dismisses the conflict without altering the form data', async () => {
    const latestSession = fakeSession({ formData: { personalInfo: { ...defaultFormData.personalInfo, firstName: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { personalInfo: VALID_PERSONAL_INFO } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());
    act(() => result.current.setField('firstName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.keepMyChanges());

    expect(result.current.conflict).toBeNull();
    expect(result.current.data.firstName).toBe('MyOwnEdit');
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values and clears dirty state', async () => {
    const latestSession = fakeSession({ formData: { personalInfo: { ...defaultFormData.personalInfo, firstName: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { personalInfo: VALID_PERSONAL_INFO } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());
    act(() => result.current.setField('firstName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.firstName).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('usePersonalInfoForm — network/server error', () => {
  it('surfaces the error message without touching local data', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { personalInfo: VALID_PERSONAL_INFO } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => usePersonalInfoForm());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_PERSONAL_INFO); // input preserved
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});
