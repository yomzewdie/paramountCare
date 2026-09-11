// Refresh-token-specific helpers, built on the generic opaque-token
// primitives in services/opaqueTokens.ts (also used by onboarding-session
// capability secrets — see routes/sessions.ts).

import { generateOpaqueToken, hashOpaqueToken } from './opaqueTokens';

export const generateRawRefreshToken = generateOpaqueToken;
export const hashRefreshToken = hashOpaqueToken;

/** Groups a login's entire rotation chain so the whole chain can be revoked together on reuse detection. */
export function generateFamilyId(): string {
  return crypto.randomUUID();
}
