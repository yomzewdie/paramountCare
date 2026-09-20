import { renderHook, act } from '@testing-library/react-native';
import { defaultW4Data } from '@pcs/shared';
import { useW4Form } from '../useW4Form';
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
    packetId: 'icu_rn',
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

const VALID_W4 = {
  ...defaultW4Data,
  firstNameMI: 'Jane M',
  lastName: 'Doe',
  ssn: '123-45-6789',
  address: '123 Main St',
  cityStateZip: 'Los Angeles, CA 90001',
  filingStatus: 'single_mfs' as const,
  typedSignature: 'Jane Doe',
  signedDate: '01/01/2026',
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useW4Form — loading', () => {
  it('populates fields from the session\'s existing w4Data', () => {
    setupSession(fakeSession({ formData: { w4Data: { ...defaultW4Data, lastName: 'Doe' } } }));
    const { result } = renderHook(() => useW4Form());
    expect(result.current.data.lastName).toBe('Doe');
  });

  it('defaults to the shared empty shape when the session has no w4Data or personalInfo yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());
    expect(result.current.data).toEqual(defaultW4Data);
  });

  it('shows no errors on load even though required fields are empty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());
    expect(result.current.errors).toEqual({});
  });

  describe('Personal Information prefill (matches existing web behavior exactly)', () => {
    it('prefills name/address from personalInfo when w4Data is completely empty', () => {
      setupSession(fakeSession({
        formData: {
          personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: 'M', address: '123 Main St', aptNumber: '4B', city: 'Los Angeles', state: 'CA', zip: '90001' },
        },
      }));
      const { result } = renderHook(() => useW4Form());
      expect(result.current.data.firstNameMI).toBe('Jane M');
      expect(result.current.data.lastName).toBe('Doe');
      expect(result.current.data.address).toBe('123 Main St Apt 4B');
      expect(result.current.data.cityStateZip).toBe('Los Angeles, CA, 90001');
    });

    it('does NOT prefill when the W-4\'s own firstNameMI/lastName/address already has a value — the one-time-only behavior', () => {
      setupSession(fakeSession({
        formData: {
          w4Data: { ...defaultW4Data, lastName: 'AlreadyTyped' },
          personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: '', address: '123 Main St', aptNumber: '', city: 'LA', state: 'CA', zip: '90001' },
        },
      }));
      const { result } = renderHook(() => useW4Form());
      expect(result.current.data.lastName).toBe('AlreadyTyped');
      expect(result.current.data.firstNameMI).toBe(''); // not overwritten from personalInfo either
    });

    it('leaves W-4 and Personal Information as independent copies — editing one does not touch session.formData.personalInfo', async () => {
      const saveStep = setupSession(
        fakeSession({ formData: { personalInfo: { firstName: 'Jane', lastName: 'Doe', middleInitial: '', address: '123 Main St', aptNumber: '', city: 'LA', state: 'CA', zip: '90001' } } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useW4Form());

      act(() => result.current.setField('lastName', 'DifferentName'));
      await act(async () => {
        await result.current.saveProgress();
      });

      const [call] = saveStep.mock.calls;
      expect(call[0].formDataKey).toBe('w4Data');
      // Only w4Data is the payload's key — personalInfo is untouched by this save.
      expect(call[0].stepData.lastName).toBe('DifferentName');
    });
  });
});

describe('useW4Form — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    expect(result.current.errors.ssn).toBeUndefined();
    act(() => result.current.blurField('ssn'));
    expect(result.current.errors.ssn).toBeTruthy();
  });

  it('does not require any Step 2/3/4 field (all genuinely optional per the real validator)', () => {
    setupSession(fakeSession({ formData: { w4Data: VALID_W4 } }));
    const { result } = renderHook(() => useW4Form());

    for (const key of ['multipleJobs', 'qualifyingChildren', 'otherDependents', 'totalDependents', 'otherIncome', 'deductions', 'extraWithholding'] as const) {
      act(() => result.current.blurField(key));
    }
    expect(Object.keys(result.current.errors)).toHaveLength(0);
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.ssn).toBeTruthy();
    expect(result.current.errors.filingStatus).toBeTruthy();
    expect(result.current.errors.typedSignature).toBeTruthy();
  });
});

describe('useW4Form — dependents auto-calculation (matches existing web behavior exactly)', () => {
  it('setQualifyingChildren updates the displayed total', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setQualifyingChildren('4000'));
    expect(result.current.displayedTotalDependents).toBe('4000');
  });

  it('setOtherDependents adds to an existing qualifying-children amount', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setQualifyingChildren('4000'));
    act(() => result.current.setOtherDependents('500'));
    expect(result.current.displayedTotalDependents).toBe('4500');
  });

  it('falls back to a manually-typed total only once both calculated fields are empty/zero', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setField('totalDependents', '999'));
    // Calculated fields are both empty, so the manual value is shown.
    expect(result.current.displayedTotalDependents).toBe('999');

    act(() => result.current.setQualifyingChildren('2000'));
    // Once a calculated field is non-zero, the computed value takes over.
    expect(result.current.displayedTotalDependents).toBe('2000');
  });
});

describe('useW4Form — signature auto-stamps signedDate (matches existing web behavior exactly)', () => {
  it('typing a signature sets a non-empty signedDate', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useW4Form());

    expect(result.current.data.signedDate).toBe('');
    act(() => result.current.setTypedSignature('Jane Doe'));
    expect(result.current.data.signedDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('clearing the signature back to empty does not clear an already-set signedDate', () => {
    setupSession(fakeSession({ formData: { w4Data: VALID_W4 } }));
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setTypedSignature(''));
    expect(result.current.data.signedDate).toBe('01/01/2026'); // unchanged, matches web's `: data.signedDate` fallback
  });
});

describe('useW4Form — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {}, stepStates: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setField('lastName', 'Doe')); // rest still invalid/empty
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'w4Data', stepId: 'w4', status: 'in_progress' }));
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { w4: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});

describe('useW4Form — complete', () => {
  it('saves with status "completed" once all required fields are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { w4Data: VALID_W4 } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepData: VALID_W4 }));
  });
});

describe('useW4Form — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server value, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { w4Data: { ...defaultW4Data, lastName: 'ServerWon' } } });
    const saveStep = setupSession(
      fakeSession({ formData: { w4Data: VALID_W4 } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    act(() => result.current.setField('lastName', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.lastName).toBe('ServerWon');
    expect(result.current.data.lastName).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values — never auto-merged', async () => {
    const latestSession = fakeSession({ formData: { w4Data: { ...defaultW4Data, lastName: 'ServerWon' } } });
    setupSession(
      fakeSession({ formData: { w4Data: VALID_W4 } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());
    act(() => result.current.setField('lastName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.lastName).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('useW4Form — network/server error', () => {
  it('surfaces the error message without touching local data (no false-saved SSN/tax data)', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { w4Data: VALID_W4 } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_W4);
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});

describe('useW4Form — server validation rejection (defense-in-depth)', () => {
  it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.saveError).toBeNull();
    expect(result.current.errors.ssn).toBeDefined();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
    setupSession(
      fakeSession({ formData: { w4Data: VALID_W4 } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useW4Form());

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
    expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
  });
});
