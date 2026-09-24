import { renderHook, waitFor, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../AuthContext';
import * as apiClient from '../../../services/apiClient';
import * as authApi from '../../../services/authApi';
import * as secureStore from '../../../services/secureStore';
import { appError } from '../../../utils/errors';

jest.mock('../../../services/apiClient');
jest.mock('../../../services/authApi');
jest.mock('../../../services/secureStore');

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedAuthApi = authApi as jest.Mocked<typeof authApi>;
const mockedSecureStore = secureStore as jest.Mocked<typeof secureStore>;

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuthContext', () => {
  it('starts in loading, then resolves to signedOut when there is nothing to restore', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedOut' });

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(result.current.user).toBeNull();
  });

  it('restores a signed-in session when a valid refresh token exists', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedIn', email: 'nurse@example.com', role: 'applicant' });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(result.current.user).toEqual({ email: 'nurse@example.com', role: 'applicant' });
  });

  it('signIn success moves status to signedIn and stores the user', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedOut' });
    mockedAuthApi.login.mockResolvedValue({
      ok: true,
      data: { email: 'nurse@example.com', role: 'applicant', accessToken: 'at', refreshToken: 'rt', expiresIn: 900 },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    await act(async () => {
      await result.current.signIn('nurse@example.com', 'Correct-Passw0rd!');
    });

    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual({ email: 'nurse@example.com', role: 'applicant' });
  });

  it('signIn failure leaves status signedOut and surfaces the error', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedOut' });
    mockedAuthApi.login.mockResolvedValue({ ok: false, error: appError('invalid_credentials') });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    let outcome: Awaited<ReturnType<typeof result.current.signIn>> | undefined;
    await act(async () => {
      outcome = await result.current.signIn('nurse@example.com', 'wrong-password');
    });

    expect(outcome?.ok).toBe(false);
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('a definitive refresh failure (via the auth-expired listener) moves a signed-in user back to signedOut', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedIn', email: 'nurse@example.com', role: 'applicant' });

    let registeredListener: (() => void) | null = null;
    mockedApiClient.setAuthExpiredListener.mockImplementation((listener) => {
      registeredListener = listener as (() => void) | null;
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedIn'));

    act(() => {
      registeredListener?.();
    });

    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('register success moves status to signedIn and stores the user — no separate sign-in step', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedOut' });
    mockedAuthApi.register.mockResolvedValue({
      ok: true,
      data: { email: 'nurse@example.com', role: 'applicant', accessToken: 'at', refreshToken: 'rt', expiresIn: 900 },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    await act(async () => {
      await result.current.register('ABCDEFGHJ2', 'Correct-Passw0rd!');
    });

    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual({ email: 'nurse@example.com', role: 'applicant' });
  });

  it('register failure (invalid invitation code) leaves status signedOut and surfaces the error', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedOut' });
    mockedAuthApi.register.mockResolvedValue({ ok: false, error: appError('invite_invalid') });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));

    let outcome: Awaited<ReturnType<typeof result.current.register>> | undefined;
    await act(async () => {
      outcome = await result.current.register('BADCODE0000', 'Correct-Passw0rd!');
    });

    expect(outcome?.ok).toBe(false);
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('signOut clears state even if the server-side revocation call fails', async () => {
    mockedApiClient.restoreSession.mockResolvedValue({ status: 'signedIn', email: 'nurse@example.com', role: 'applicant' });
    mockedSecureStore.getStoredRefreshToken.mockResolvedValue('some-refresh-token');
    mockedAuthApi.logout.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedIn'));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockedAuthApi.logout).toHaveBeenCalledWith('some-refresh-token');
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });
});
