import { renderHook, waitFor, act } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../SessionContext';
import { createSessionEnsurer } from '../ensureSession';
import * as sessionApi from '../sessionApi';
import { appError } from '../../../utils/errors';
import type { SessionResponse } from '../sessionApi';

// SessionContext creates its own ensurer per Provider instance (see
// ensureSession.ts and SessionContext.tsx for why — no module-level
// singleton) via createSessionEnsurer(), so that's what's mocked here.
jest.mock('../ensureSession', () => ({
  createSessionEnsurer: jest.fn(() => ({ ensure: mockEnsure })),
}));
jest.mock('../sessionApi', () => ({
  ...jest.requireActual('../sessionApi'),
  updateSession: jest.fn(),
  associateDocument: jest.fn(),
  removeDocument: jest.fn(),
}));

const mockEnsure = jest.fn();
const mockedUpdateSession = sessionApi.updateSession as jest.Mock;
const mockedAssociateDocument = sessionApi.associateDocument as jest.Mock;
const mockedRemoveDocument = sessionApi.removeDocument as jest.Mock;

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 5,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    stepStates: { personal_info: 'completed' },
    formData: {},
    status: 'active',
    applicationId: null,
    revision: 3,
    completionPercent: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => jest.clearAllMocks());

describe('SessionContext', () => {
  it('starts loading, then becomes ready with the session and derived progress', async () => {
    const session = fakeSession();
    mockEnsure.mockResolvedValue({ ok: true, session });

    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.session).toEqual(session);
    expect(result.current.progress?.completedSteps.map((s) => s.id)).toEqual(['personal_info']);
  });

  it('preserves the exact revision the server returned, without modification', async () => {
    const session = fakeSession({ revision: 7 });
    mockEnsure.mockResolvedValue({ ok: true, session });

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.session?.revision).toBe(7);
  });

  it('moves to an error state on failure, without a session', async () => {
    mockEnsure.mockResolvedValue({ ok: false, error: appError('network') });

    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.session).toBeNull();
    expect(result.current.error?.code).toBe('network');
  });

  it('refresh() re-runs the ensure flow and can recover from a prior error', async () => {
    mockEnsure.mockResolvedValueOnce({ ok: false, error: appError('network') });
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));

    const session = fakeSession();
    mockEnsure.mockResolvedValueOnce({ ok: true, session });
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.session).toEqual(session);
    expect(mockEnsure).toHaveBeenCalledTimes(2);
  });

  it('creates a fresh ensurer on every mount, so a new sign-in never inherits a previous identity\'s in-flight state', async () => {
    mockEnsure.mockResolvedValue({ ok: true, session: fakeSession() });

    const first = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount(); // e.g. sign-out — the (app) group, and this Provider, unmounts

    const second = renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    // One call per mount — proves SessionContext doesn't reuse a single
    // module-level ensurer across a sign-out/sign-back-in cycle.
    expect(createSessionEnsurer).toHaveBeenCalledTimes(2);
  });

  describe('saveStep', () => {
    it('sends the merge-safe patch and replaces the context session with the server response on success', async () => {
      const initial = fakeSession({ revision: 3, formData: { employmentApplication: { positionApplied: 'RN' } }, stepStates: { employment_application: 'in_progress' } });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const updated = fakeSession({ revision: 4, formData: { employmentApplication: { positionApplied: 'RN' }, personalInfo: { firstName: 'Jane' } }, stepStates: { employment_application: 'in_progress', personal_info: 'completed' } });
      mockedUpdateSession.mockResolvedValue({ ok: true, data: updated });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.saveStep>> | undefined;
      await act(async () => {
        outcome = await result.current.saveStep({ formDataKey: 'personalInfo', stepData: { firstName: 'Jane' }, stepId: 'personal_info', status: 'completed' });
      });

      expect(outcome).toEqual({ status: 'saved', session: updated });
      expect(result.current.session).toEqual(updated); // context now reflects the new revision/data

      const [, payload] = mockedUpdateSession.mock.calls[0];
      expect(payload).toEqual({
        revision: 3, // the revision that was current BEFORE this save
        formData: { employmentApplication: { positionApplied: 'RN' }, personalInfo: { firstName: 'Jane' } }, // full merge, other step preserved
        stepStates: { employment_application: 'in_progress', personal_info: 'completed' }, // full merge, other step preserved
      });
    });

    it('on a 409 conflict, updates the context session to the fresh server state and reports the conflict distinctly', async () => {
      const initial = fakeSession({ revision: 3 });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const fresh = fakeSession({ revision: 9, formData: { personalInfo: { firstName: 'SomeoneElseEdited' } } });
      mockedUpdateSession.mockResolvedValue({ ok: false, conflict: true, current: fresh });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.saveStep>> | undefined;
      await act(async () => {
        outcome = await result.current.saveStep({ formDataKey: 'personalInfo', stepData: { firstName: 'Mine' }, stepId: 'personal_info' });
      });

      expect(outcome).toEqual({ status: 'conflict', latestSession: fresh });
      // The context reflects the fresh session so a subsequent retry uses
      // the correct revision automatically — but this happens WITHOUT the
      // caller's own local (unsaved) form values being touched by
      // SessionContext itself; only the caller decides what to do with those.
      expect(result.current.session).toEqual(fresh);
    });

    it('on a generic error, leaves the context session untouched', async () => {
      const initial = fakeSession({ revision: 3 });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      mockedUpdateSession.mockResolvedValue({ ok: false, conflict: false, error: appError('server_error') });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.saveStep>> | undefined;
      await act(async () => {
        outcome = await result.current.saveStep({ formDataKey: 'personalInfo', stepData: {}, stepId: 'personal_info' });
      });

      expect(outcome).toEqual({ status: 'error', error: appError('server_error') });
      expect(result.current.session).toEqual(initial); // unchanged
    });
  });

  describe('associateDocument (M13 hardening)', () => {
    it('sends the current revision to the ownership-verified document endpoint and updates context on success', async () => {
      const initial = fakeSession({ revision: 3, formData: {} });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const updated = fakeSession({ revision: 4, formData: { directDepositProofDocument: { name: 'check.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/x.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' } } });
      mockedAssociateDocument.mockResolvedValue({ ok: true, data: updated });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.associateDocument>> | undefined;
      await act(async () => {
        outcome = await result.current.associateDocument('direct_deposit_voided_check', 'uploads/1/x.jpg');
      });

      expect(outcome).toEqual({ status: 'saved', session: updated });
      expect(result.current.session).toEqual(updated);
      expect(mockedAssociateDocument).toHaveBeenCalledWith('sess-1', 'direct_deposit_voided_check', { objectKey: 'uploads/1/x.jpg', revision: 3 });
    });

    it('on a 409 conflict, updates the context session and reports the conflict distinctly', async () => {
      const initial = fakeSession({ revision: 3 });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const fresh = fakeSession({ revision: 9 });
      mockedAssociateDocument.mockResolvedValue({ ok: false, conflict: true, current: fresh });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.associateDocument>> | undefined;
      await act(async () => {
        outcome = await result.current.associateDocument('direct_deposit_voided_check', 'uploads/1/x.jpg');
      });

      expect(outcome).toEqual({ status: 'conflict', latestSession: fresh });
      expect(result.current.session).toEqual(fresh);
    });

    it('on a generic error, leaves the context session untouched', async () => {
      const initial = fakeSession({ revision: 3 });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      mockedAssociateDocument.mockResolvedValue({ ok: false, conflict: false, error: appError('server_error') });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.associateDocument>> | undefined;
      await act(async () => {
        outcome = await result.current.associateDocument('direct_deposit_voided_check', 'uploads/1/x.jpg');
      });

      expect(outcome).toEqual({ status: 'error', error: appError('server_error') });
      expect(result.current.session).toEqual(initial);
    });
  });

  describe('removeDocument (M13 hardening)', () => {
    it('sends the current revision and updates context on success', async () => {
      const initial = fakeSession({ revision: 5, formData: { directDepositProofDocument: { name: 'check.jpg', size: 1, type: 'image/jpeg' } } });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const updated = fakeSession({ revision: 6, formData: { directDepositProofDocument: null } });
      mockedRemoveDocument.mockResolvedValue({ ok: true, data: updated });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.removeDocument>> | undefined;
      await act(async () => {
        outcome = await result.current.removeDocument('direct_deposit_voided_check');
      });

      expect(outcome).toEqual({ status: 'saved', session: updated });
      expect(result.current.session).toEqual(updated);
      expect(mockedRemoveDocument).toHaveBeenCalledWith('sess-1', 'direct_deposit_voided_check', { revision: 5 });
    });

    it('on a 409 conflict, updates the context session and reports the conflict distinctly', async () => {
      const initial = fakeSession({ revision: 5 });
      mockEnsure.mockResolvedValue({ ok: true, session: initial });
      const fresh = fakeSession({ revision: 11 });
      mockedRemoveDocument.mockResolvedValue({ ok: false, conflict: true, current: fresh });

      const { result } = renderHook(() => useSession(), { wrapper });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let outcome: Awaited<ReturnType<typeof result.current.removeDocument>> | undefined;
      await act(async () => {
        outcome = await result.current.removeDocument('direct_deposit_voided_check');
      });

      expect(outcome).toEqual({ status: 'conflict', latestSession: fresh });
      expect(result.current.session).toEqual(fresh);
    });
  });
});
