// Onboarding session IDs are high-entropy and unguessable — an anonymous
// (not-yet-claimed) session's "credential" is simply knowledge of this ID,
// mirroring how a browser holding localStorage data is today's implicit
// ownership model. A UUID gives ample entropy for that purpose.

export function generateSessionId(): string {
  return crypto.randomUUID();
}
