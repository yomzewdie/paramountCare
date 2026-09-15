import { z } from 'zod';

export const createSessionSchema = z.object({
  packetId: z.string().min(1, 'packetId is required'),
});
export type CreateSessionPayload = z.infer<typeof createSessionSchema>;

const stepStatusSchema = z.enum(['not_started', 'in_progress', 'completed', 'failed', 'skipped']);

// formData is intentionally loosely typed here (a plain object of unknown
// values), not the full OnboardingFormData shape from @pcs/shared — mirroring
// that full shape in a parallel Zod schema would duplicate the same rules in
// two places and risks rejecting valid payloads on any future drift between
// the two. Business-rule validation for specific steps is instead enforced
// via @pcs/shared/validation (isStepValid) at the point a step is marked
// "completed" — see worker/src/routes/sessions.ts.
export const updateSessionSchema = z.object({
  revision: z.number().int().nonnegative('revision must be a non-negative integer'),
  stepStates: z.record(z.string(), stepStatusSchema).optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});
export type UpdateSessionPayload = z.infer<typeof updateSessionSchema>;

// M13 hardening: associating/removing an uploaded document from a session
// document slot (e.g. Direct Deposit's voided check) — a narrower sibling
// of updateSessionSchema, not a formData field, since the objectKey itself
// requires a server-side ownership check the generic PATCH path has no way
// to perform (see routes/sessions.ts, services/documents.ts).
export const associateDocumentSchema = z.object({
  objectKey: z.string().min(1, 'objectKey is required'),
  revision: z.number().int().nonnegative('revision must be a non-negative integer'),
});
export type AssociateDocumentPayload = z.infer<typeof associateDocumentSchema>;

export const removeDocumentSchema = z.object({
  revision: z.number().int().nonnegative('revision must be a non-negative integer'),
});
export type RemoveDocumentPayload = z.infer<typeof removeDocumentSchema>;
