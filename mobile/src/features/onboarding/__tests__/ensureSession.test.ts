import { createSessionEnsurer } from '../ensureSession';
import type { SessionResponse, ApiResult } from '../sessionApi';
import { appError } from '../../../utils/errors';

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
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createSessionEnsurer', () => {
  it('returns the existing session without creating one when GET /mine finds one', async () => {
    const session = fakeSession();
    const getMySession = jest.fn(async (): Promise<ApiResult<SessionResponse | null>> => ({ ok: true, data: session }));
    const createSession = jest.fn(async (): Promise<ApiResult<SessionResponse>> => ({ ok: true, data: session }));

    const ensurer = createSessionEnsurer({ getMySession, createSession });
    const outcome = await ensurer.ensure('general_rn');

    expect(outcome).toEqual({ ok: true, session });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('creates a session when none exists', async () => {
    const created = fakeSession({ sessionId: 'sess-new' });
    const getMySession = jest.fn(async (): Promise<ApiResult<SessionResponse | null>> => ({ ok: true, data: null }));
    const createSession = jest.fn(async (): Promise<ApiResult<SessionResponse>> => ({ ok: true, data: created }));

    const ensurer = createSessionEnsurer({ getMySession, createSession });
    const outcome = await ensurer.ensure('general_rn');

    expect(outcome).toEqual({ ok: true, session: created });
    expect(createSession).toHaveBeenCalledWith('general_rn');
  });

  it('propagates a GET failure without attempting to create', async () => {
    const getMySession = jest.fn(async (): Promise<ApiResult<SessionResponse | null>> => ({ ok: false, error: appError('network') }));
    const createSession = jest.fn();

    const ensurer = createSessionEnsurer({ getMySession, createSession: createSession as never });
    const outcome = await ensurer.ensure('general_rn');

    expect(outcome.ok).toBe(false);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('propagates a CREATE failure', async () => {
    const getMySession = jest.fn(async (): Promise<ApiResult<SessionResponse | null>> => ({ ok: true, data: null }));
    const createSession = jest.fn(async (): Promise<ApiResult<SessionResponse>> => ({ ok: false, error: appError('server_error') }));

    const ensurer = createSessionEnsurer({ getMySession, createSession });
    const outcome = await ensurer.ensure('general_rn');

    expect(outcome).toEqual({ ok: false, error: appError('server_error') });
  });

  it('coalesces concurrent ensure() calls into a single GET and a single CREATE — never two sessions', async () => {
    const d = deferred<ApiResult<SessionResponse | null>>();
    const getMySession = jest.fn(() => d.promise);
    const created = fakeSession({ sessionId: 'only-one' });
    const createSession = jest.fn(async (): Promise<ApiResult<SessionResponse>> => ({ ok: true, data: created }));

    const ensurer = createSessionEnsurer({ getMySession, createSession });

    // Simulates React Strict Mode / concurrent mounts: three callers all
    // ask for a session before the first GET has even resolved.
    const p1 = ensurer.ensure('general_rn');
    const p2 = ensurer.ensure('general_rn');
    const p3 = ensurer.ensure('general_rn');

    expect(getMySession).toHaveBeenCalledTimes(1);

    d.resolve({ ok: true, data: null });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ ok: true, session: created });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it('starts a fresh ensure() after a previous one has fully resolved', async () => {
    const first = fakeSession({ sessionId: 'first' });
    const getMySession = jest
      .fn<Promise<ApiResult<SessionResponse | null>>, []>()
      .mockResolvedValueOnce({ ok: true, data: first })
      .mockResolvedValueOnce({ ok: true, data: first });
    const createSession = jest.fn();

    const ensurer = createSessionEnsurer({ getMySession, createSession: createSession as never });

    await ensurer.ensure('general_rn');
    await ensurer.ensure('general_rn');

    expect(getMySession).toHaveBeenCalledTimes(2);
  });
});
