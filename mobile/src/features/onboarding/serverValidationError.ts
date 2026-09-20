import type { AppError } from '../../utils/errors';

/**
 * A 422 the Worker's own re-validation produced when marking a step
 * "completed" (worker/src/routes/sessions.ts) — this should be rare in
 * practice, since the client's own @pcs/shared validator already blocks a
 * Complete attempt locally before any request is sent, and the Worker calls
 * that exact same shared function server-side. If it ever does fire — a
 * stale client build, a future drift between client/server packet config, a
 * race — the Worker's response names only the STEP that failed
 * (`field: stepId`), never a specific form field, because the PATCH body's
 * `formData` is an intentionally opaque `z.record(z.unknown())`
 * (worker/src/schemas/sessions.ts) — the one authoritative shape check IS
 * the shared validator, not a duplicate per-field Zod schema the server
 * could report granular issues from. There is no per-field detail in this
 * 422's own payload for mobile to map.
 *
 * What IS reasonable, and what this enables: treat the rejection exactly
 * like a local "invalid" outcome instead of a generic top-of-screen banner.
 * The same shared validator that produced the server's rejection already
 * ran client-side, so its field errors are already sitting in the hook's
 * own `errors` state — revealing them (touchAll) and scrolling to the first
 * one is strictly more helpful, using zero invented information.
 */
export function isStepValidationRejection(error: AppError): boolean {
  return error.code === 'validation';
}
