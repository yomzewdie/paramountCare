import * as SecureStore from 'expo-secure-store';
import { getStoredRefreshToken, setStoredRefreshToken, clearStoredRefreshToken } from '../secureStore';

// expo-secure-store is mocked globally in jest.setup.js — this test verifies
// our wrapper calls it correctly (right key, right calls), not SecureStore's
// own behavior.

describe('secureStore refresh-token wrapper', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the refresh token under a single well-known key', async () => {
    await getStoredRefreshToken();
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('pcs.refreshToken');
  });

  it('writes the refresh token under the same key', async () => {
    await setStoredRefreshToken('some-token');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('pcs.refreshToken', 'some-token');
  });

  it('deletes the refresh token on clear', async () => {
    await clearStoredRefreshToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pcs.refreshToken');
  });
});
