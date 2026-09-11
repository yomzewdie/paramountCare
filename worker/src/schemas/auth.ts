import { z } from 'zod';

// Registration is invite-only (product decision — see
// docs/ARCHITECTURE_DECISION_RECORDS.md's invite-only-registration addendum):
// the applicant's email is always derived server-side from the invitation
// record, never trusted from client input, so there is deliberately no
// `email` field here. No onboarding data (SSN, DOB, address, I-9/W-4 fields,
// employment history) is collected at registration — only what's needed to
// create the account.
export const registerSchema = z.object({
  inviteToken: z.string().min(1, 'inviteToken is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type RegisterPayload = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  deviceLabel: z.string().max(200).optional(),
});
export type LoginPayload = z.infer<typeof loginSchema>;

// Mobile/API clients send the refresh token in the body; admin web sends it
// via an HttpOnly cookie instead, so this field is optional at the schema
// level — the route decides which source is authoritative for that caller.
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshPayload = z.infer<typeof refreshSchema>;

export const verifyEmailSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type VerifyEmailPayload = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type ResendVerificationPayload = z.infer<typeof resendVerificationSchema>;
