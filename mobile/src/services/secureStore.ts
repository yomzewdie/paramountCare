import * as SecureStore from 'expo-secure-store';

// The ONLY place the refresh token touches disk. Backed by iOS Keychain /
// Android Keystore (what expo-secure-store uses under the hood) — never
// AsyncStorage, never a plain file. The access token never reaches this
// module at all; it lives only in tokenStore.ts's in-memory variable.
//
// Biometric-gating seam (not implemented in M3, structured for later): to
// require Face ID / Touch ID / Android biometric unlock before the refresh
// token can be read back, this call becomes
//   SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
//     requireAuthentication: true,
//     keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
//   })
// on both get/set — a client-side, non-breaking change to *when* the app is
// willing to read a token it already has (same reasoning as
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-008 §"Future biometric login").
// Not enabled now because it would block automated testing/CI and hasn't
// been scoped for this milestone.

const REFRESH_TOKEN_KEY = 'pcs.refreshToken';

export async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearStoredRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
