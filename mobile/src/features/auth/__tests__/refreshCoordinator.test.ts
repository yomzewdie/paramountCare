import { createRefreshCoordinator, type RefreshOutcome } from '../refreshCoordinator';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createRefreshCoordinator', () => {
  it('calls the underlying refresh function exactly once for concurrent callers', async () => {
    const d = deferred<RefreshOutcome>();
    const refreshFn = jest.fn(() => d.promise);
    const coordinator = createRefreshCoordinator(refreshFn);

    const p1 = coordinator.refresh('token-a');
    const p2 = coordinator.refresh('token-a');
    const p3 = coordinator.refresh('token-a');

    expect(refreshFn).toHaveBeenCalledTimes(1);

    d.resolve({ ok: true, accessToken: 'at', refreshToken: 'rt', expiresIn: 900, email: 'a@example.com', role: 'applicant' });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(refreshFn).toHaveBeenCalledTimes(1);
  });

  it('starts a new refresh after the previous one completes', async () => {
    const refreshFn = jest
      .fn<Promise<RefreshOutcome>, [string]>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, accessToken: 'at2', refreshToken: 'rt2', expiresIn: 900, email: 'a@example.com', role: 'applicant' });

    const coordinator = createRefreshCoordinator(refreshFn);

    const first = await coordinator.refresh('token-a');
    expect(first.ok).toBe(false);

    const second = await coordinator.refresh('token-b');
    expect(second.ok).toBe(true);
    expect(refreshFn).toHaveBeenCalledTimes(2);
  });

  it('never lets a failed refresh keep future calls stuck waiting', async () => {
    const refreshFn = jest.fn<Promise<RefreshOutcome>, [string]>().mockRejectedValueOnce(new Error('network down'));
    const coordinator = createRefreshCoordinator(refreshFn);

    await expect(coordinator.refresh('token-a')).rejects.toThrow('network down');

    const refreshFn2Result: RefreshOutcome = { ok: true, accessToken: 'at', refreshToken: 'rt', expiresIn: 900, email: 'a@example.com', role: 'applicant' };
    refreshFn.mockResolvedValueOnce(refreshFn2Result);
    const outcome = await coordinator.refresh('token-a');
    expect(outcome).toEqual(refreshFn2Result);
  });
});
