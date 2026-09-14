import type { StepStatus } from '@pcs/shared';
import type { SessionResponse, UpdateSessionPayload } from './sessionApi';

// The Worker's PATCH /api/sessions/:id treats `formData` and `stepStates` as
// FULL REPLACEMENTS of the stored JSON blobs, not deep merges — confirmed by
// reading worker/src/routes/sessions.ts directly (`formDataJson: p.formData
// ? JSON.stringify(p.formData) : undefined`, same for `stepStatesJson`).
// Sending only `{ formData: { personalInfo: {...} } }` would silently wipe
// every OTHER step's previously-saved data. This is not a backend defect —
// the existing revision check already makes "always spread the full
// last-known session, override just this step's key" completely safe
// against lost updates across devices (a stale spread can never succeed:
// the revision it carries would be rejected with 409 first) — but it is a
// real footgun if a caller forgets to do it. This is the ONE place that
// spread happens, so every future step reuses it rather than re-deriving
// the same discipline independently.

export interface StepPatchInput {
  session: SessionResponse;
  /** The key on OnboardingFormData this step owns, e.g. 'personalInfo'. */
  formDataKey: string;
  /** The new value for that one key — never the whole formData object. */
  stepData: unknown;
  /** The packet step id, e.g. 'personal_info' — used as the stepStates key. */
  stepId: string;
  /** Omit to leave the step's status untouched (rare); pass explicitly for
   * both partial saves ('in_progress') and completion ('completed'). */
  status?: StepStatus;
}

export function buildStepPatch(input: StepPatchInput): UpdateSessionPayload {
  const { session, formDataKey, stepData, stepId, status } = input;

  return {
    revision: session.revision,
    formData: { ...session.formData, [formDataKey]: stepData },
    stepStates: status ? { ...session.stepStates, [stepId]: status } : session.stepStates,
  };
}
