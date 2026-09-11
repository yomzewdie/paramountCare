import { renderHook, waitFor, act } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../SessionContext';
import { createSessionEnsurer } from '../ensureSession';
import { appError } from '../../../utils/errors';
import type { SessionResponse } from '../sessionApi';

// SessionContext creates its own ensurer per Provider instance (see
// ensureSession.ts and SessionContext.tsx for why — no module-level
// singleton) via createSessionEnsurer(), so that's what's mocked here.
jest.mock('../ensureSession', () => ({
  createSessionEnsurer: jest.fn(() => ({ ensure: mockEnsure })),
}));

const mockEnsure = jest.fn();

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
});
