import { renderHook, act } from '@testing-library/react-native';
import { SAFETY_TOPIC_KEYS, useSafetyAcknowledgementsForm } from '../useSafetyAcknowledgementsForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';
import type { SafetyEducationData } from '@pcs/shared';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

const mockedUseSession = useSession as jest.Mock;

const ALL_TRUE: SafetyEducationData = {
  patientSafety: true,
  infectionControl: true,
  fireSafety: true,
  patientRightsHipaa: true,
  workplaceViolence: true,
  backSafety: true,
  hazardousMaterials: true,
  documentationStandards: true,
  examAttestation: true,
};

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

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn();
  mockedUseSession.mockReturnValue({ session, saveStep, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return saveStep;
}

beforeEach(() => jest.clearAllMocks());

/**
 * Deliberately NOT built on useAcknowledgementForm's test suite pattern of
 * a single checked/typedSignature/signedAt entry — the real source model
 * (SafetySection.tsx) is 8 independent topic booleans plus one attestation
 * boolean, with no signature field anywhere. See ADR-028.
 */
describe('useSafetyAcknowledgementsForm', () => {
  describe('loading', () => {
    it('starts with every topic and the attestation unchecked when no prior data exists', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      for (const key of SAFETY_TOPIC_KEYS) {
        expect(result.current.data[key]).toBe(false);
      }
      expect(result.current.data.examAttestation).toBe(false);
      expect(result.current.topicsChecked).toBe(0);
      expect(result.current.totalTopics).toBe(8);
      expect(result.current.allTopicsChecked).toBe(false);
    });

    it('rehydrates from an already-saved session', () => {
      setupSession(fakeSession({ formData: { safetyEducation: { ...ALL_TRUE, examAttestation: false } } }));
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      expect(result.current.topicsChecked).toBe(8);
      expect(result.current.allTopicsChecked).toBe(true);
      expect(result.current.data.examAttestation).toBe(false);
    });
  });

  describe('toggling topics', () => {
    it('toggling one topic does not affect the others', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('fireSafety'));
      expect(result.current.data.fireSafety).toBe(true);
      expect(result.current.data.infectionControl).toBe(false);
      expect(result.current.topicsChecked).toBe(1);
    });

    it('allTopicsChecked flips true only once all 8 topics are checked, independent of the attestation', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      for (const key of SAFETY_TOPIC_KEYS.slice(0, 7)) {
        act(() => result.current.toggleTopic(key));
      }
      expect(result.current.allTopicsChecked).toBe(false);
      act(() => result.current.toggleTopic(SAFETY_TOPIC_KEYS[7]));
      expect(result.current.allTopicsChecked).toBe(true);
      expect(result.current.data.examAttestation).toBe(false);
    });

    it('toggling the attestation before all topics are checked does not mark the step valid', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleAttestation());
      expect(result.current.data.examAttestation).toBe(true);
      // errors are hidden until touched, but the underlying validator still
      // reports the topics as incomplete
      expect(result.current.allTopicsChecked).toBe(false);
    });
  });

  /**
   * M15 hardening: `examAttestation` must never survive a change to the
   * underlying 8-topic set it was given against — confirmed the web
   * SafetySection.tsx's own `toggle()` has NO such reset (a plain flip,
   * same gap), so this is a mobile-only truthfulness fix, not a mirror of
   * existing source behavior. Applies both to live toggling and to
   * anything read from storage (initial load, conflict rehydration).
   */
  describe('attestation reset on topic change', () => {
    function allChecked(result: ReturnType<typeof useSafetyAcknowledgementsForm>) {
      for (const key of SAFETY_TOPIC_KEYS) result.toggleTopic(key);
    }

    it('all 8 checked + attestation checked is a valid, complete state', async () => {
      const saveStep = setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => allChecked(result.current));
      act(() => result.current.toggleAttestation());
      expect(result.current.data.examAttestation).toBe(true);

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('unchecking any topic after attestation clears the attestation', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => allChecked(result.current));
      act(() => result.current.toggleAttestation());
      expect(result.current.data.examAttestation).toBe(true);

      act(() => result.current.toggleTopic('fireSafety'));

      expect(result.current.data.fireSafety).toBe(false);
      expect(result.current.data.examAttestation).toBe(false);
    });

    it('re-checking the topic afterward does NOT restore the cleared attestation — it stays false until explicitly re-attested', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => allChecked(result.current));
      act(() => result.current.toggleAttestation());
      act(() => result.current.toggleTopic('fireSafety')); // clears attestation
      act(() => result.current.toggleTopic('fireSafety')); // back to all-8-checked

      expect(result.current.allTopicsChecked).toBe(true);
      expect(result.current.data.examAttestation).toBe(false);
    });

    it('toggling a topic while attestation is already false has no special effect (normal independent toggling still works)', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));
      expect(result.current.data.patientSafety).toBe(true);
      expect(result.current.data.examAttestation).toBe(false);
      act(() => result.current.toggleTopic('patientSafety'));
      expect(result.current.data.patientSafety).toBe(false);
      expect(result.current.data.examAttestation).toBe(false);
    });

    it('partial save preserves the cleared attestation state', async () => {
      const saveStep = setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => allChecked(result.current));
      act(() => result.current.toggleAttestation());
      act(() => result.current.toggleTopic('fireSafety'));
      act(() => result.current.toggleTopic('fireSafety'));

      await act(async () => { await result.current.saveProgress(); });

      const [call] = saveStep.mock.calls;
      const savedStepData = call[0].stepData as SafetyEducationData;
      expect(savedStepData.examAttestation).toBe(false);
      expect(savedStepData.fireSafety).toBe(true);
    });

    it('rehydration normalizes an inconsistent stored state (examAttestation true but a topic missing) to cleared', () => {
      const inconsistent = { ...ALL_TRUE, fireSafety: false }; // examAttestation true, one topic false
      setupSession(fakeSession({ formData: { safetyEducation: inconsistent } }));
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      expect(result.current.data.examAttestation).toBe(false);
      expect(result.current.data.fireSafety).toBe(false);
    });

    it('conflict rehydration (discardAndReloadLatest) normalizes the server\'s latest the same way', async () => {
      const inconsistentLatest = fakeSession({ formData: { safetyEducation: { ...ALL_TRUE, fireSafety: false } } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession: inconsistentLatest } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));
      await act(async () => { await result.current.saveProgress(); });

      expect(result.current.conflict?.latest.examAttestation).toBe(false);

      act(() => result.current.discardAndReloadLatest());
      expect(result.current.data.examAttestation).toBe(false);
      expect(result.current.data.fireSafety).toBe(false);
    });
  });

  describe('validation', () => {
    it('complete() blocks and reveals a combined _topics error when topics are unchecked', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors._topics).toBeTruthy();
      expect(result.current.errors._topics).toContain('8');
    });

    it('complete() blocks on a missing attestation even when all 8 topics are checked', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      for (const key of SAFETY_TOPIC_KEYS) {
        act(() => result.current.toggleTopic(key));
      }

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors._topics).toBeUndefined();
      expect(result.current.errors.examAttestation).toBeTruthy();
    });

    it('errors are hidden until the first complete() attempt', async () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      expect(result.current.errors).toEqual({});
      await act(async () => { await result.current.complete(); });
      expect(result.current.errors._topics).toBeTruthy();
    });
  });

  describe('complete', () => {
    it('completes once all 8 topics and the attestation are checked', async () => {
      const saveStep = setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      for (const key of SAFETY_TOPIC_KEYS) {
        act(() => result.current.toggleTopic(key));
      }
      act(() => result.current.toggleAttestation());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed', stepId: 'safety_acknowledgements', formDataKey: 'safetyEducation' }),
      );
    });
  });

  describe('partial save', () => {
    it('saveProgress() saves whatever is currently checked with no validation gate', async () => {
      const saveStep = setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress' }));
    });

    it('never downgrades an already-completed step back to in_progress on save', async () => {
      const saveStep = setupSession(
        fakeSession({ stepStates: { safety_acknowledgements: 'completed' }, formData: { safetyEducation: ALL_TRUE } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());

      await act(async () => { await result.current.saveProgress(); });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict and remembers the latest server value without touching local edits', async () => {
      const latestSession = fakeSession({ formData: { safetyEducation: ALL_TRUE } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict?.latest.examAttestation).toBe(true);
      expect(result.current.data.patientSafety).toBe(true);
    });

    it('discardAndReloadLatest() replaces local data with the server latest', async () => {
      const latestSession = fakeSession({ formData: { safetyEducation: ALL_TRUE } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));
      await act(async () => { await result.current.saveProgress(); });

      act(() => result.current.discardAndReloadLatest());

      expect(result.current.conflict).toBeNull();
      expect(result.current.allTopicsChecked).toBe(true);
      expect(result.current.data.examAttestation).toBe(true);
    });

    it('keepMyChanges() dismisses the conflict without altering local data', async () => {
      const latestSession = fakeSession({ formData: { safetyEducation: ALL_TRUE } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      act(() => result.current.toggleTopic('patientSafety'));
      await act(async () => { await result.current.saveProgress(); });

      act(() => result.current.keepMyChanges());

      expect(result.current.conflict).toBeNull();
      expect(result.current.topicsChecked).toBe(1);
    });
  });

  describe('isCompleted', () => {
    it('reflects session.stepStates for this step id', () => {
      setupSession(fakeSession({ stepStates: { safety_acknowledgements: 'completed' } }));
      const { result } = renderHook(() => useSafetyAcknowledgementsForm());
      expect(result.current.isCompleted).toBe(true);
    });
  });
});
