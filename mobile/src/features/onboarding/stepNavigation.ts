import { useLocalSearchParams, useRouter } from 'expo-router';
import { groupStepsIntoPhases } from './phases';
import { useSession } from './SessionContext';
import type { StepDisplayItem } from './steps';

// Where a step screen goes after the applicant saves it.
//
// Step screens live in the Onboarding tab's stack, but are opened from Home,
// the Onboarding list, or Review. Leaving a step with a blind router.back()
// popped whatever happened to be underneath it in that stack — after
// Home → Resume → Continue (back to Home, the Resume screen still sitting in
// the Onboarding stack) → Home → Personal Information → Continue, "back" landed
// on the stale Resume screen. Exits are therefore explicit:
//
//  - Continue (step completed): the next not-yet-completed step AFTER this
//    one in the same phase, in packet order — replacing this screen, so step
//    screens never pile up. Never backward, never into another phase.
//  - End of the phase, or Save Progress: back to where the applicant came
//    from (Home, the Onboarding list, or Review), with the step stack
//    cleared.
//  - Opened from Review ("Edit"): always straight back to Review.
//
// Home's "Continue" still opens the first incomplete required step
// (steps.ts's resolveNextRequiredStep) — that is where onboarding resumes.

export type StepOrigin = 'home' | 'onboarding' | 'review';

/** The next step after `stepId` in the same phase that is not yet completed,
 * in packet order; null when this is the phase's last open step. */
export function nextStepInPhase(steps: StepDisplayItem[], stepId: string): StepDisplayItem | null {
  const phase = groupStepsIntoPhases(steps).find((p) => p.steps.some((s) => s.id === stepId));
  if (!phase) return null;
  const index = phase.steps.findIndex((s) => s.id === stepId);
  return phase.steps.slice(index + 1).find((s) => !s.completed) ?? null;
}

export type StepExit =
  | { kind: 'next'; stepId: string }
  | { kind: 'leave'; to: StepOrigin };

/** Pure decision behind useStepNavigation — what to do after saving. */
export function decideStepExit(
  steps: StepDisplayItem[] | undefined,
  stepId: string,
  origin: StepOrigin,
  completed: boolean,
): StepExit {
  if (completed && origin !== 'review' && steps) {
    const next = nextStepInPhase(steps, stepId);
    if (next) return { kind: 'next', stepId: next.id };
  }
  return { kind: 'leave', to: origin };
}

function parseOrigin(value: unknown): StepOrigin {
  return value === 'home' || value === 'review' ? value : 'onboarding';
}

export function useStepNavigation() {
  const router = useRouter();
  const { progress } = useSession();
  const params = useLocalSearchParams<{ stepId: string; origin?: string }>();
  const stepId = params.stepId ?? '';
  const origin = parseOrigin(params.origin);

  function go(exit: StepExit): void {
    if (exit.kind === 'next') {
      router.replace({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: exit.stepId, origin } });
      return;
    }
    if (exit.to === 'review') {
      router.back();
      return;
    }
    // Clear the step stack (back to the Onboarding list at its root), then
    // return to Home if that's where the applicant came from.
    if (router.canDismiss()) router.dismissAll();
    if (exit.to === 'home') router.navigate('/(app)/home');
  }

  return {
    origin,
    /** After Continue — the step was just marked complete. */
    afterComplete: () => go(decideStepExit(progress?.steps, stepId, origin, true)),
    /** After Save Progress, or the header's back button. */
    leave: () => go({ kind: 'leave', to: origin }),
  };
}
