import type { JwtPayload } from './utils/jwt';

export type AppEnv = {
  Bindings: Env & {
    RESEND_API_KEY: string;
    ADMIN_NOTIFICATION_EMAIL: string;
    ADMIN_JWT_SECRET: string;  // Cloudflare secret — never in wrangler.jsonc
    // Cloudflare secret — never in wrangler.jsonc, never persisted to D1. Keys
    // the HMAC used to store email-verification codes (services/emailVerification.ts)
    // so a D1 leak alone doesn't let an attacker brute-force a 6-digit code
    // offline with plain SHA-256 (1,000,000 guesses is trivial without a
    // secret key; HMAC-SHA256 with an unknown key is not). Deliberately a
    // separate secret from ADMIN_JWT_SECRET rather than reused for it — they
    // protect different things (session forgery vs. offline OTP recovery),
    // and a future JWT-signing-key rotation shouldn't have to reason about
    // whether it also invalidates in-flight verification codes, or vice versa.
    EMAIL_VERIFICATION_SECRET: string;
    // Base URL the invitation email links to. The Expo app doesn't exist yet
    // (M3), so this is deliberately configuration, not a hardcoded produced
    // link — set it to a real web fallback or universal/deep-link base once
    // one exists. Falls back to a local-dev placeholder if unset (see
    // routes/invites.ts) so tests and local development don't require it.
    APPLICANT_INVITE_BASE_URL?: string;
    // Non-secret var, set in wrangler.jsonc (currently always "development" —
    // see ADR-013, no production environment exists yet). Used only as a
    // fail-safe in routes/invites.ts so a production deploy that forgets to
    // set APPLICANT_INVITE_BASE_URL throws instead of silently emailing
    // applicants a localhost link.
    ENVIRONMENT: string;
  };
  Variables: {
    // Set by requireAuth before any route or further middleware in the chain
    // runs. Left optional at the type level as a defensive guard, not
    // because any current code path leaves it unset for a route that reads it.
    jwtPayload?: JwtPayload;
  };
};
