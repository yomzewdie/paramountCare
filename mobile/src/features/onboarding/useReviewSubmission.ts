import { useMemo, useState } from 'react';
import { useSession } from './SessionContext';
import type { SubmitResult } from './SessionContext';
import type { IncompleteStepInfo } from './sessionApi';
import type { AppError } from '../../utils/errors';

export type SubmitOutcome =
  | { kind: 'submitted'; applicationId: string; alreadySubmitted: boolean }
  | { kind: 'conflict' }
  | { kind: 'incomplete'; incompleteSteps: IncompleteStepInfo[] }
  | { kind: 'error'; message: string };

/**
 * Review's own readiness/submission logic (M16, ADR-029). Deliberately
 * reads `progress.steps` from the SAME `SessionContext`/`deriveProgress`
 * every other screen already uses — never a second computation of what's
 * complete (M4 instructions §9, restated for this milestone's own §9).
 *
 * `readyToSubmit` is NOT `progress.isComplete`: that flag (built on the
 * shared `isPacketComplete`) requires `review` itself to already be
 * 'completed' — which is impossible before a first successful submission,
 * since submitting IS what completes `review`. This re-derives "every
 * OTHER required step is done" the same way the Worker's own
 * services/submission.ts does, from the identical `progress.steps` data,
 * not a separate reimplementation of packet-walking logic.
 */
export function useReviewSubmission() {
  const { session, progress, submitApplication } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [incompleteSteps, setIncompleteSteps] = useState<IncompleteStepInfo[] | null>(null);

  const requiredSteps = useMemo(
    () => (progress?.steps ?? []).filter((s) => s.required && s.id !== 'review'),
    [progress],
  );
  const optionalSteps = useMemo(
    () => (progress?.steps ?? []).filter((s) => !s.required && s.id !== 'review'),
    [progress],
  );
  const incompleteRequiredSteps = useMemo(() => requiredSteps.filter((s) => !s.completed), [requiredSteps]);
  const readyToSubmit = incompleteRequiredSteps.length === 0;

  const isSubmitted = session?.status === 'submitted';
  const applicationId = session?.applicationId ?? null;

  function errorMessage(error: AppError): string {
    return error.message;
  }

  async function submit(): Promise<SubmitOutcome> {
    setSubmitError(null);
    setConflict(false);
    setIncompleteSteps(null);

    if (!readyToSubmit) {
      setIncompleteSteps(incompleteRequiredSteps.map((s) => ({ id: s.id, label: s.label })));
      return { kind: 'incomplete', incompleteSteps: incompleteRequiredSteps.map((s) => ({ id: s.id, label: s.label })) };
    }

    setIsSubmitting(true);
    const result: SubmitResult = await submitApplication();
    setIsSubmitting(false);

    switch (result.status) {
      case 'submitted':
        return { kind: 'submitted', applicationId: result.data.applicationId, alreadySubmitted: result.data.alreadySubmitted };
      case 'conflict':
        setConflict(true);
        return { kind: 'conflict' };
      case 'incomplete':
        setIncompleteSteps(result.incompleteSteps);
        return { kind: 'incomplete', incompleteSteps: result.incompleteSteps };
      case 'error':
        setSubmitError(errorMessage(result.error));
        return { kind: 'error', message: errorMessage(result.error) };
    }
  }

  return {
    requiredSteps,
    optionalSteps,
    incompleteRequiredSteps,
    readyToSubmit,
    isSubmitted,
    applicationId,
    isSubmitting,
    submitError,
    conflict,
    incompleteSteps,
    submit,
  };
}
