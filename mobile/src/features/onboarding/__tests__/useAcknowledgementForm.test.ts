import { renderHook, act } from '@testing-library/react-native';
import { getPacket } from '@pcs/shared';
import { useAcknowledgementForm } from '../useAcknowledgementForm';
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

const VALID_ENTRY = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z' };

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

/**
 * Generalized from M8's useApplicationStatementForm.test.ts, once
 * Background Authorization (M10) proved the hook works identically for a
 * second real acknowledgement step. Health Information Authorization
 * (M11) is a THIRD independently-confirmed example — its own pre-flight
 * checked the real packet config/validateStep dispatch rather than
 * assuming compatibility from the word "auth" in its name (see ADR-023).
 * Every scenario below runs once per stepId to prove genuine reuse, not a
 * renamed single-step test.
 */
describe.each([
  ['application_statement', 'I certify that the answers given herein are true and complete'],
  ['background_auth', 'BACKGROUND INVESTIGATION AUTHORIZATION'],
  ['health_info_auth', 'AUTHORIZATION FOR DISCLOSURE OF HEALTH INFORMATION'],
])('useAcknowledgementForm(%s)', (stepId, expectedTextFragment) => {
  describe('loading', () => {
    it('reads the statement text, heading, and requiresSignature flag from the current session\'s packet', () => {
      setupSession(fakeSession({ packetId: 'general_rn' }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      expect(result.current.statementText).toContain(expectedTextFragment);
      expect(result.current.heading).toBe(getPacket('general_rn')!.steps.find((s) => s.id === stepId)!.label);
      expect(result.current.requiresSignature).toBe(true);
    });

    it('populates from the session\'s existing acknowledgements entry for this step', () => {
      setupSession(fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      expect(result.current.data).toEqual(VALID_ENTRY);
    });

    it('reads only its OWN stepId, ignoring a different acknowledgement stored under the same key', () => {
      const otherStepId = stepId === 'application_statement' ? 'background_auth' : 'application_statement';
      setupSession(fakeSession({ formData: { acknowledgements: { [otherStepId]: { checked: true, typedSignature: 'Other', signedAt: '2026-01-01T00:00:00.000Z' } } } }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      expect(result.current.data).toEqual({ checked: false, typedSignature: '', signedAt: '' });
    });

    it('shows no errors on load even though the statement is unsigned', () => {
      setupSession(fakeSession({ formData: {} }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      expect(result.current.errors).toEqual({});
    });
  });

  describe('signature behavior', () => {
    it('checking the box stamps a client-derived signedAt timestamp', () => {
      setupSession(fakeSession({ formData: {} }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      expect(result.current.data.signedAt).toBe('');
      act(() => result.current.toggleChecked());
      expect(result.current.data.checked).toBe(true);
      expect(result.current.data.signedAt).not.toBe('');
    });

    it('unchecking the box clears signedAt', () => {
      setupSession(fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      act(() => result.current.toggleChecked());
      expect(result.current.data.checked).toBe(false);
      expect(result.current.data.signedAt).toBe('');
    });

    it('setTypedSignature updates the signature text and marks dirty', () => {
      setupSession(fakeSession({ formData: {} }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      expect(result.current.isDirty).toBe(false);
      act(() => result.current.setTypedSignature('Jane Doe'));
      expect(result.current.data.typedSignature).toBe('Jane Doe');
      expect(result.current.isDirty).toBe(true);
    });
  });

  describe('validation', () => {
    it('reveals the signature error only after it has been blurred', () => {
      setupSession(fakeSession({ formData: {} }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      expect(result.current.errors.typedSignature).toBeUndefined();
      act(() => result.current.blurSignature());
      expect(result.current.errors.typedSignature).toBeTruthy();
    });

    it('complete() blocks and reveals every error when unchecked/unsigned, without saving', async () => {
      const saveStep = setupSession(fakeSession({ formData: {} }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      let outcome;
      await act(async () => {
        outcome = await result.current.complete();
      });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.checked).toBeTruthy();
      expect(result.current.errors.typedSignature).toBeTruthy();
    });

    it('blocks completion when checked but the signature is blank', async () => {
      const saveStep = setupSession(fakeSession({ formData: { acknowledgements: { [stepId]: { checked: true, typedSignature: '', signedAt: '2026-01-01T00:00:00.000Z' } } } }));
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      let outcome;
      await act(async () => {
        outcome = await result.current.complete();
      });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
    });
  });

  describe('partial save', () => {
    it('saves current data as-is, with no validation gate, marking the step in_progress', async () => {
      const saveStep = setupSession(
        fakeSession({ formData: {}, stepStates: {} }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      act(() => result.current.toggleChecked()); // rest still invalid (no signature)
      await act(async () => {
        await result.current.saveProgress();
      });

      expect(saveStep).toHaveBeenCalledWith(
        expect.objectContaining({ formDataKey: 'acknowledgements', stepId, status: 'in_progress' }),
      );
    });

    it('preserves a DIFFERENT acknowledgement already saved under the same formData key', async () => {
      const otherStepId = stepId === 'application_statement' ? 'background_auth' : 'application_statement';
      const otherAck = { checked: true, typedSignature: 'Other Step', signedAt: '2026-01-01T00:00:00.000Z' };
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { [otherStepId]: otherAck } } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      act(() => result.current.setTypedSignature('Jane Doe'));
      await act(async () => {
        await result.current.saveProgress();
      });

      const [call] = saveStep.mock.calls;
      const savedStepData = call[0].stepData as Record<string, unknown>;
      expect(savedStepData[otherStepId]).toEqual(otherAck);
      expect((savedStepData[stepId] as { typedSignature: string }).typedSignature).toBe('Jane Doe');
    });

    it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
      const saveStep = setupSession(
        fakeSession({ stepStates: { [stepId]: 'completed' } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      await act(async () => {
        await result.current.saveProgress();
      });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    });
  });

  describe('complete', () => {
    it('saves with status "completed" once checked and signed', async () => {
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      let outcome;
      await act(async () => {
        outcome = await result.current.complete();
      });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepId }));
    });

    it('allows re-completing an already-completed statement (no immutability lock)', async () => {
      const saveStep = setupSession(
        fakeSession({
          formData: { acknowledgements: { [stepId]: VALID_ENTRY } },
          stepStates: { [stepId]: 'completed' },
        }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      act(() => result.current.setTypedSignature('Jane A. Doe')); // re-signing with a slightly different name

      let outcome;
      await act(async () => {
        outcome = await result.current.complete();
      });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict from saveStep and remembers the latest server value, without touching local edits', async () => {
      const latestSession = fakeSession({ formData: { acknowledgements: { [stepId]: { checked: true, typedSignature: 'ServerWon', signedAt: '2026-01-02T00:00:00.000Z' } } } });
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      act(() => result.current.setTypedSignature('MyOwnEdit'));

      let outcome;
      await act(async () => {
        outcome = await result.current.saveProgress();
      });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict?.latest.typedSignature).toBe('ServerWon');
      expect(result.current.data.typedSignature).toBe('MyOwnEdit');
      expect(saveStep).toHaveBeenCalledTimes(1);
    });

    it('keepMyChanges dismisses the conflict without altering the form data', async () => {
      const latestSession = fakeSession({ formData: { acknowledgements: { [stepId]: { checked: true, typedSignature: 'ServerWon', signedAt: '2026-01-02T00:00:00.000Z' } } } });
      setupSession(
        fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      act(() => result.current.setTypedSignature('MyOwnEdit'));
      await act(async () => {
        await result.current.saveProgress();
      });

      act(() => result.current.keepMyChanges());

      expect(result.current.conflict).toBeNull();
      expect(result.current.data.typedSignature).toBe('MyOwnEdit');
    });

    it('discardAndReloadLatest replaces local data with the server\'s latest signature and clears dirty state', async () => {
      const latestSession = fakeSession({ formData: { acknowledgements: { [stepId]: { checked: true, typedSignature: 'ServerWon', signedAt: '2026-01-02T00:00:00.000Z' } } } });
      setupSession(
        fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));
      act(() => result.current.setTypedSignature('MyOwnEdit'));
      await act(async () => {
        await result.current.saveProgress();
      });

      act(() => result.current.discardAndReloadLatest());

      expect(result.current.data.typedSignature).toBe('ServerWon');
      expect(result.current.isDirty).toBe(false);
      expect(result.current.conflict).toBeNull();
    });
  });

  describe('network/server error', () => {
    it('surfaces the error message without touching local data', async () => {
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { [stepId]: VALID_ENTRY } } }),
        jest.fn().mockResolvedValue({ status: 'error', error: { code: 'network', message: 'Unable to reach Paramount Care.' } } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useAcknowledgementForm(stepId));

      let outcome;
      await act(async () => {
        outcome = await result.current.saveProgress();
      });

      expect(outcome).toEqual({ kind: 'error', message: 'Unable to reach Paramount Care.' });
      expect(result.current.saveError).toBe('Unable to reach Paramount Care.');
      expect(result.current.data).toEqual(VALID_ENTRY);
      expect(saveStep).toHaveBeenCalledTimes(1);
    });
  });
});
