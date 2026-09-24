/**
 * Masks an email's local part for display to an unauthenticated caller (the
 * public invite-validation endpoint): "yoazeb@gmail.com" -> "y***@gmail.com".
 * Shows only the first character before the `@` — enough for an applicant
 * who already knows their own email to recognize it as correct, not enough
 * to be useful to anyone else. The full email is never returned by that
 * endpoint; only this masked form is (see routes/inviteValidation.ts).
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***'; // malformed input — never throw, never echo it back verbatim
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${localPart[0]}***@${domain}`;
}
