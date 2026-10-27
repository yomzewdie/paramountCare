import { renderHook, act } from '@testing-library/react-native';
import { defaultEmploymentReference } from '@pcs/shared';
import { useEmploymentReferenceForm } from '../useEmploymentReferenceForm';
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

const VALID_REFERENCE = {
  ...defaultEmploymentReference,
  supervisorName: 'Jane Supervisor',
  supervisorTitle: 'Nurse Manager',
  employerName: "St. Mary's Medical Center",
  supervisorPhone: '555-000-1111',
  permissionGranted: true,
};

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useEmploymentReferenceForm — loading', () => {
  it('populates fields from the session\'s existing reference at this stepId', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...defaultEmploymentReference, supervisorName: 'RN' } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    expect(result.current.data.supervisorName).toBe('RN');
  });

  it('reads only its OWN stepId, ignoring a different reference stored under the same key', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_2: { ...defaultEmploymentReference, supervisorName: 'Other Ref' } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    expect(result.current.data.supervisorName).toBe('');
  });

  it('defaults to the shared empty shape when nothing is stored yet', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    expect(result.current.data).toEqual(defaultEmploymentReference);
  });

  it('shows no errors on load even though required fields are empty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    expect(result.current.errors).toEqual({});
  });
});

describe('useEmploymentReferenceForm — validation', () => {
  it('reveals a field\'s error only after it has been blurred', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    expect(result.current.errors.supervisorName).toBeUndefined();
    act(() => result.current.blurField('supervisorName'));
    expect(result.current.errors.supervisorName).toBeTruthy();
  });

  it('setField marks the form dirty', () => {
    setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setField('supervisorName', 'RN'));
    expect(result.current.isDirty).toBe(true);
  });

  it('flags a format error (malformed phone) distinctly from a missing-field error, once touched', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...VALID_REFERENCE, supervisorPhone: 'x' } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.blurField('supervisorPhone'));

    expect(result.current.errors.supervisorPhone).toBe('Enter a valid 10-digit phone number.');
    expect(result.current.errors.supervisorName).toBeUndefined();
  });

  it('rehire eligibility and work-history details are no longer required (they come from the resume / the reference check)', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...VALID_REFERENCE, eligibleForRehire: false, rehireDetails: '' } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    for (const field of ['rehireDetails', 'eligibleForRehire', 'positionHeld', 'employmentDateFrom', 'employerCity'] as const) {
      act(() => result.current.blurField(field));
    }
    expect(result.current.errors).toEqual({});
  });

  it('an invalid optional email is flagged once touched; blank is fine', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    act(() => result.current.blurField('supervisorEmail'));
    expect(result.current.errors.supervisorEmail).toBeUndefined();
    act(() => result.current.setField('supervisorEmail', 'nope'));
    expect(result.current.errors.supervisorEmail).toBeTruthy();
  });

  it('a reference saved by the old manual form loads, stays valid, and keeps its work-history values on save', async () => {
    const legacy = { ...VALID_REFERENCE, positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '06/2023', employerCity: 'LA', employerState: 'CA', eligibleForRehire: true };
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: legacy } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    await act(async () => { await result.current.complete(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      stepData: { employment_ref_1: expect.objectContaining({ positionHeld: 'RN', employmentDateFrom: '01/2020', eligibleForRehire: true }) },
    }));
  });

  it('requires the permission consent checkbox to be checked', () => {
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...VALID_REFERENCE, permissionGranted: false } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.blurField('permissionGranted'));
    expect(result.current.errors.permissionGranted).toBeTruthy();
  });

  it('complete() blocks and reveals every error when the form is invalid, without saving', async () => {
    const saveStep = setupSession(fakeSession({ formData: {} }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.supervisorName).toBeTruthy();
    expect(result.current.errors.permissionGranted).toBeTruthy();
  });
});

describe('useEmploymentReferenceForm — partial save', () => {
  it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {}, stepStates: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.setField('supervisorName', 'RN')); // rest still invalid/empty
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(
      expect.objectContaining({ formDataKey: 'employmentReferences', stepId: 'employment_ref_1', status: 'in_progress' }),
    );
  });

  it('preserves a DIFFERENT reference already saved under the same formData key', async () => {
    const otherRef = { ...defaultEmploymentReference, supervisorName: 'Already Saved Ref 2' };
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_2: otherRef } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.setField('supervisorName', 'RN'));
    await act(async () => {
      await result.current.saveProgress();
    });

    const [call] = saveStep.mock.calls;
    const stepData = call[0].stepData as Record<string, unknown>;
    expect(stepData.employment_ref_2).toEqual(otherRef);
    expect((stepData.employment_ref_1 as { supervisorName: string }).supervisorName).toBe('RN');
  });

  it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { employment_ref_1: 'completed' } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });

  // M9: EmploymentReferenceScreen/useEmploymentReferenceForm were built
  // stepId-generic in M6 specifically so a second reference instance would
  // need no new component. These tests instantiate the hook FOR
  // employment_ref_2 directly (not just as "the other reference" in a
  // ref_1 test above) to prove the same hook works correctly and
  // independently for a second instance, not merely by coincidence.
  it('works identically for employment_ref_2, loading only its own data', async () => {
    const ref1 = { ...defaultEmploymentReference, supervisorName: 'Ref 1 Data' };
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: ref1 } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_2'));

    expect(result.current.data).toEqual(defaultEmploymentReference); // empty, not ref_1's data
  });

  it('saving employment_ref_2 preserves employment_ref_1\'s already-saved data', async () => {
    const ref1 = { ...defaultEmploymentReference, supervisorName: 'Ref 1 Data' };
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: ref1 } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_2'));

    act(() => result.current.setField('supervisorName', 'Ref 2 Data'));
    await act(async () => {
      await result.current.saveProgress();
    });

    const [call] = saveStep.mock.calls;
    const stepData = call[0].stepData as Record<string, unknown>;
    expect(stepData.employment_ref_1).toEqual(ref1);
    expect((stepData.employment_ref_2 as { supervisorName: string }).supervisorName).toBe('Ref 2 Data');
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'employment_ref_2' }));
  });

  it('completing employment_ref_1 does not mark employment_ref_2 as completed, and vice versa (independent step statuses)', async () => {
    const saveStep = setupSession(
      fakeSession({ stepStates: { employment_ref_2: 'completed' } }), // ref_2 already done, ref_1 is not
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    // ref_1 itself is not completed, so a plain save still marks IT in_progress —
    // proving isCompleted is read per-stepId, not shared across reference instances.
    await act(async () => {
      await result.current.saveProgress();
    });

    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'employment_ref_1', status: 'in_progress' }));
  });
});

describe('useEmploymentReferenceForm — complete', () => {
  it('saves with status "completed" once all required fields are valid', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.complete();
    });

    expect(outcome).toEqual({ kind: 'saved' });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepId: 'employment_ref_1' }));
    const [call] = saveStep.mock.calls;
    expect((call[0].stepData as Record<string, unknown>).employment_ref_1).toEqual(VALID_REFERENCE);
  });
});

describe('useEmploymentReferenceForm — conflict handling', () => {
  it('surfaces a conflict from saveStep and remembers the latest server value for THIS stepId, without touching local edits', async () => {
    const latestSession = fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...defaultEmploymentReference, supervisorName: 'ServerWon' } } } });
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.setField('supervisorName', 'MyOwnEdit'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'conflict' });
    expect(result.current.conflict?.latest.supervisorName).toBe('ServerWon');
    expect(result.current.data.supervisorName).toBe('MyOwnEdit');
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('keepMyChanges dismisses the conflict without altering the form data', async () => {
    const latestSession = fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...defaultEmploymentReference, supervisorName: 'ServerWon' } } } });
    setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    act(() => result.current.setField('supervisorName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.keepMyChanges());

    expect(result.current.conflict).toBeNull();
    expect(result.current.data.supervisorName).toBe('MyOwnEdit');
  });

  it('discardAndReloadLatest replaces local data with the server\'s latest values and clears dirty state', async () => {
    const latestSession = fakeSession({ formData: { employmentReferences: { employment_ref_1: { ...defaultEmploymentReference, supervisorName: 'ServerWon' } } } });
    setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    act(() => result.current.setField('supervisorName', 'MyOwnEdit'));
    await act(async () => {
      await result.current.saveProgress();
    });

    act(() => result.current.discardAndReloadLatest());

    expect(result.current.data.supervisorName).toBe('ServerWon');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.conflict).toBeNull();
  });
});

describe('useEmploymentReferenceForm — network/server error', () => {
  it('surfaces the error message without touching local data', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveProgress();
    });

    expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
    expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
    expect(result.current.data).toEqual(VALID_REFERENCE);
    expect(saveStep).toHaveBeenCalledTimes(1);
  });
});

describe('useEmploymentReferenceForm — server validation rejection (defense-in-depth)', () => {
  it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(result.current.saveError).toBeNull();
    expect(result.current.errors.supervisorName).toBeDefined();
    expect(saveStep).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
    setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    let outcome;
    await act(async () => { outcome = await result.current.saveProgress(); });

    expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
    expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
  });
});

// M10: employment_ref_3 (Travel RN only, optional) reuses this exact same
// hook/screen — confirming a THIRD reference instance stays independent
// from #1 and #2 is what makes wiring it into the real-step registry
// (rather than building a new component) actually safe, not just convenient.
describe('useEmploymentReferenceForm — employment_ref_3 (M10, optional/Travel RN)', () => {
  it('loads only its own data, independent of Reference #1 and #2', () => {
    const ref1 = { ...defaultEmploymentReference, supervisorName: 'Ref 1 Data' };
    const ref2 = { ...defaultEmploymentReference, supervisorName: 'Ref 2 Data' };
    setupSession(fakeSession({ formData: { employmentReferences: { employment_ref_1: ref1, employment_ref_2: ref2 } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_3'));

    expect(result.current.data).toEqual(defaultEmploymentReference);
  });

  it('saving employment_ref_3 preserves BOTH Reference #1 and #2\'s already-saved data', async () => {
    const ref1 = { ...defaultEmploymentReference, supervisorName: 'Ref 1 Data' };
    const ref2 = { ...defaultEmploymentReference, supervisorName: 'Ref 2 Data' };
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: ref1, employment_ref_2: ref2 } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_3'));

    act(() => result.current.setField('supervisorName', 'Ref 3 Data'));
    await act(async () => {
      await result.current.saveProgress();
    });

    const [call] = saveStep.mock.calls;
    const stepData = call[0].stepData as Record<string, unknown>;
    expect(stepData.employment_ref_1).toEqual(ref1);
    expect(stepData.employment_ref_2).toEqual(ref2);
    expect((stepData.employment_ref_3 as { supervisorName: string }).supervisorName).toBe('Ref 3 Data');
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'employment_ref_3' }));
  });

  it('leaving Reference #3 incomplete does not corrupt or block saving Reference #1/#2 independently', async () => {
    // Reference #3 is optional and simply absent from formData — Reference
    // #1's own save must still succeed and must not require #3 to exist.
    const saveStep = setupSession(
      fakeSession({ formData: {} }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));

    act(() => result.current.setField('supervisorName', 'RN'));
    await act(async () => {
      await result.current.saveProgress();
    });

    const [call] = saveStep.mock.calls;
    const stepData = call[0].stepData as Record<string, unknown>;
    expect(stepData.employment_ref_3).toBeUndefined();
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'employment_ref_1' }));
  });
});

describe('useEmploymentReferenceForm — Supervisor Title replaces Reason for Leaving (all references)', () => {
  it.each(['employment_ref_1', 'employment_ref_2', 'employment_ref_3'])('%s requires supervisorTitle and not reasonForLeaving', async (stepId) => {
    const saveStep = setupSession(fakeSession({ formData: { employmentReferences: { [stepId]: { ...VALID_REFERENCE, supervisorTitle: '' } } } }));
    const { result } = renderHook(() => useEmploymentReferenceForm(stepId));

    let outcome;
    await act(async () => { outcome = await result.current.complete(); });
    expect(outcome).toEqual({ kind: 'invalid' });
    expect(saveStep).not.toHaveBeenCalled();
    expect(result.current.errors.supervisorTitle).toBe('Supervisor title is required');
    expect(result.current.errors).not.toHaveProperty('reasonForLeaving');
  });

  it('captures supervisorTitle in the saved reference', async () => {
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_2: VALID_REFERENCE } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_2'));
    act(() => result.current.setField('supervisorTitle', 'Director of Nursing'));
    await act(async () => { await result.current.complete(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      stepData: { employment_ref_2: expect.objectContaining({ supervisorTitle: 'Director of Nursing' }) },
    }));
  });

  it('a reference saved before the change keeps its historical reasonForLeaving on load and save', async () => {
    const legacy = { ...VALID_REFERENCE, supervisorTitle: undefined, reasonForLeaving: 'Relocation' };
    const saveStep = setupSession(
      fakeSession({ formData: { employmentReferences: { employment_ref_1: legacy } } }),
      jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
    );
    const { result } = renderHook(() => useEmploymentReferenceForm('employment_ref_1'));
    expect(result.current.data.reasonForLeaving).toBe('Relocation');

    act(() => result.current.setField('supervisorTitle', 'Charge RN'));
    await act(async () => { await result.current.complete(); });
    expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({
      stepData: { employment_ref_1: expect.objectContaining({ reasonForLeaving: 'Relocation', supervisorTitle: 'Charge RN' }) },
    }));
  });
});
