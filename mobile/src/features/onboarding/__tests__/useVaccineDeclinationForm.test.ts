import { renderHook, act } from '@testing-library/react-native';
import { getPacket } from '@pcs/shared';
import { useVaccineDeclinationForm } from '../useVaccineDeclinationForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = useSession as jest.Mock;
const STEP_ID = 'hep_b_declination';

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

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

describe('useVaccineDeclinationForm', () => {
  describe('loading', () => {
    it('reads heading, requiresSignature, and vaccineType from the real hep_b_declination packet config', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      const step = getPacket('general_rn')!.steps.find((s) => s.id === STEP_ID)!;
      expect(result.current.heading).toBe(step.label);
      expect(result.current.requiresSignature).toBe(step.config?.requiresSignature);
      expect(result.current.vaccineType).toBe(step.config?.vaccineType);
    });

    it('starts with no decision made and no errors shown', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      expect(result.current.data.decision).toBeNull();
      expect(result.current.errors).toEqual({});
    });

    it('reads only its OWN stepId, ignoring a different acknowledgement stored under the same key', () => {
      setupSession(fakeSession({ formData: { acknowledgements: { tdap_declination: { checked: true, typedSignature: 'Other', signedAt: '2026-01-01T00:00:00.000Z', decision: 'declining' } } } }));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      expect(result.current.data.decision).toBeNull();
    });
  });

  describe('decision branching', () => {
    it('choosing "declining" then switching to "providing_proof" clears checked/typedSignature/signedAt', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));
      expect(result.current.data.checked).toBe(true);
      expect(result.current.data.typedSignature).toBe('Jane Doe');

      act(() => result.current.setDecision('providing_proof'));
      expect(result.current.data.checked).toBe(false);
      expect(result.current.data.typedSignature).toBe('');
      expect(result.current.data.signedAt).toBe('');
    });

    it('staying on "declining" preserves checked/typedSignature when re-selected', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setDecision('declining'));
      expect(result.current.data.checked).toBe(true);
    });

    it('choosing "providing_proof" requires nothing further — no errors once selected', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));
      expect(result.current.errors).toEqual({});
    });
  });

  describe('validation', () => {
    it('complete() blocks and reveals the decision error when nothing has been selected', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.decision).toBeTruthy();
    });

    it('complete() blocks when declining but unchecked/unsigned', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.checked).toBeTruthy();
      expect(result.current.errors.typedSignature).toBeTruthy();
    });
  });

  describe('complete', () => {
    it('completes immediately once "providing_proof" is selected — no upload required at this step', async () => {
      const saveStep = setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepId: STEP_ID }));
    });

    it('completes once declining with a checked box and typed signature', async () => {
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
    });

    it('preserves a DIFFERENT acknowledgement already saved under the same formData key', async () => {
      const otherAck = { checked: true, typedSignature: 'Other Step', signedAt: '2026-01-01T00:00:00.000Z' };
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { application_statement: otherAck } } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      await act(async () => { await result.current.saveProgress(); });

      const [call] = saveStep.mock.calls;
      const savedStepData = call[0].stepData as Record<string, unknown>;
      expect(savedStepData.application_statement).toEqual(otherAck);
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict and remembers the latest server value without touching local edits', async () => {
      const latestSession = fakeSession({ formData: { acknowledgements: { [STEP_ID]: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' } } } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict?.latest.decision).toBe('providing_proof');
      expect(result.current.data.decision).toBe('declining');
    });
  });
});
