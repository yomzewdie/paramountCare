// Parses an incoming deep link for the invite token the Worker embeds as a
// `token` query parameter (worker/src/routes/invites.ts: `${baseUrl}?token=${rawToken}`).
// This is the ONLY place in the mobile app that reads a raw invite token out
// of a URL — never logged here or anywhere it's passed to (register.tsx
// holds it only in local component/navigation-param state just long enough
// to submit the registration request, then never again).
//
// Uses the standard WHATWG `URL` (available globally in both React Native's
// runtime and Node/Jest) rather than expo-linking's parser — this is pure
// string parsing with no dependency on Expo Router's own path-matching or
// scheme configuration, which is a separate concern (Expo Router auto-routes
// a matching incoming URL to app/(auth)/register.tsx on its own; this
// function only needs to pull the token back out once that's happened).

export function parseInviteTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const token = parsed.searchParams.get('token');
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
