// The access token lives ONLY here: a module-level variable, never persisted
// to disk, never AsyncStorage, never SecureStore. It's gone on app kill —
// that's intentional (see AuthContext's launch-time restoration, which
// re-derives a fresh access token from the securely-stored refresh token
// instead). Kept outside React state/context deliberately: apiClient.ts's
// fetch interceptor needs to read the current token synchronously from
// outside the render tree, and writing it needs no re-render of its own —
// only signInStatus changes (in AuthContext) should trigger UI updates.
//
// Never log the value of this token — grep the codebase for
// `getAccessToken()` before adding any console.log/console.error near it.

let currentAccessToken: string | null = null;

export function getAccessToken(): string | null {
  return currentAccessToken;
}

export function setAccessToken(token: string | null): void {
  currentAccessToken = token;
}
