import * as secureStore from '../secureStore';
import { setAccessToken, getAccessToken } from '../tokenStore';
import { authenticatedFetch } from '../apiClient';

jest.mock('../secureStore');
const mockedSecureStore = secureStore as jest.Mocked<typeof secureStore>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('authenticatedFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAccessToken(null);
  });

  it('passes through a successful response with no refresh attempted', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const res = await authenticatedFetch('https://test.invalid/api/sessions/mine');
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('on a 401 with a stored refresh token, refreshes once and retries exactly once', async () => {
    mockedSecureStore.getStoredRefreshToken.mockResolvedValue('old-refresh-token');
    mockedSecureStore.setStoredRefreshToken.mockResolvedValue(undefined);

    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' })) // original request
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900, email: 'a@example.com', role: 'applicant' }),
      ) // refresh call
      .mockResolvedValueOnce(jsonResponse(200, { data: 'the actual thing' })); // retried original request

    const res = await authenticatedFetch('https://test.invalid/api/sessions/mine');

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'the actual thing' });
    expect(getAccessToken()).toBe('new-access');
    expect(mockedSecureStore.setStoredRefreshToken).toHaveBeenCalledWith('new-refresh');
  });

  it('with no stored refresh token, gives up after the first 401 without retrying', async () => {
    mockedSecureStore.getStoredRefreshToken.mockResolvedValue(null);
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    const res = await authenticatedFetch('https://test.invalid/api/sessions/mine');

    expect(res.status).toBe(401);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // never even attempted a refresh call
    expect(mockedSecureStore.clearStoredRefreshToken).toHaveBeenCalled();
  });

  it('when refresh itself fails, clears storage and returns the original 401 without an infinite loop', async () => {
    mockedSecureStore.getStoredRefreshToken.mockResolvedValue('dead-refresh-token');
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Unauthorized' })) // original request
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or expired refresh token' })); // refresh call fails

    const res = await authenticatedFetch('https://test.invalid/api/sessions/mine');

    expect(res.status).toBe(401);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // original + refresh attempt — NOT a third retry
    expect(mockedSecureStore.clearStoredRefreshToken).toHaveBeenCalled();
  });

  it('coalesces two concurrent 401s into a single refresh call', async () => {
    mockedSecureStore.getStoredRefreshToken.mockResolvedValue('old-refresh-token');
    mockedSecureStore.setStoredRefreshToken.mockResolvedValue(undefined);

    let refreshCalls = 0;
    globalThis.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(200, { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900, email: 'a@example.com', role: 'applicant' }),
        );
      }
      return Promise.resolve(jsonResponse(401, { error: 'Unauthorized' }));
    });

    await Promise.all([
      authenticatedFetch('https://test.invalid/api/sessions/mine'),
      authenticatedFetch('https://test.invalid/api/auth/me'),
    ]);

    expect(refreshCalls).toBe(1);
  });
});
