import type { StepStatus } from '@pcs/shared';
import type { StepDisplayItem } from './steps';

// Presentation-only grouping layer over the real, authoritative packet step
// order (packages/shared/src/packets.ts) — never a second source of truth
// for packet membership, order, required/optional, or completion. Every
// function here operates on StepDisplayItem[] (steps.ts's own derivation
// from the real session + packet), so a phase's steps are always a strict
// subset of the real packet.steps, in the real packet's own order.
//
// Confirmed directly against packets.ts (not assumed) before this map was
// written: general_rn/lvn share one 19-step sequence (personal_info ...
// employment_application, application_statement, employment_ref_1/2,
// background_auth, health_info_auth, patient_bill_of_rights,
// hep_b/tdap/flu_declination, w4, i9, direct_deposit, documents,
// jcaho_review, safety_acknowledgements, safety_exam[optional], review);
// icu_rn/er_rn share a condensed 12-step sequence (no health_info_auth,
// patient_bill_of_rights, vaccine declinations, jcaho_review, or
// safety_exam); travel_rn is that same 12-step sequence plus an optional
// employment_ref_3. Walking each real sequence against the membership map
// below produces a strictly non-decreasing phase-index sequence for every
// one of the five packets (verified in phases.test.ts) — i.e. every phase
// is a genuinely CONTIGUOUS slice of the real order for every packet that
// exists today, so no step was reordered to make it fit.
//
// The one deliberate compromise vs. the originally-proposed grouping: W-4
// and I-9 sit AFTER the three vaccine declinations in the real general_rn/
// lvn order, not before them — putting W-4/I-9 in the "authorizations"
// group (as first proposed) would require skipping over the declinations,
// breaking contiguity. They're grouped with the declinations/direct
// deposit/documents instead ("Pay, Health & Documents"), and the
// authorizations group is renamed to reflect what actually remains in it.
export type OnboardingPhaseId = 'about_you' | 'authorizations' | 'pay_health_documents' | 'safety_review';

export interface OnboardingPhaseDef {
  id: OnboardingPhaseId;
  label: string;
}

export const ONBOARDING_PHASES: OnboardingPhaseDef[] = [
  { id: 'about_you', label: 'About You & Work History' },
  { id: 'authorizations', label: 'Authorizations & Acknowledgements' },
  { id: 'pay_health_documents', label: 'Pay, Health & Documents' },
  { id: 'safety_review', label: 'Safety & Final Review' },
];

// Every step ID that exists in ANY current packet must appear here exactly
// once — groupStepsIntoPhases() throws on an unmapped ID rather than
// silently dropping it, so a future packet change that adds a step here
// fails loudly (see the "no step lost" test) instead of quietly vanishing
// from the applicant's journey.
const STEP_ID_TO_PHASE: Record<string, OnboardingPhaseId> = {
  personal_info: 'about_you',
  employment_application: 'about_you',
  application_statement: 'about_you',
  employment_ref_1: 'about_you',
  employment_ref_2: 'about_you',
  employment_ref_3: 'about_you', // travel_rn only, optional

  background_auth: 'authorizations',
  health_info_auth: 'authorizations', // general_rn/lvn only
  patient_bill_of_rights: 'authorizations', // general_rn/lvn only

  hep_b_declination: 'pay_health_documents', // general_rn/lvn only
  tdap_declination: 'pay_health_documents', // general_rn/lvn only
  flu_declination: 'pay_health_documents', // general_rn/lvn only
  w4: 'pay_health_documents',
  i9: 'pay_health_documents',
  direct_deposit: 'pay_health_documents',
  documents: 'pay_health_documents',

  jcaho_review: 'safety_review', // general_rn/lvn only
  safety_acknowledgements: 'safety_review',
  safety_exam: 'safety_review', // general_rn/lvn only, optional
  review: 'safety_review',
};

export interface OnboardingPhaseGroup extends OnboardingPhaseDef {
  steps: StepDisplayItem[];
}

/**
 * Splits a packet's real, ordered step list into the four applicant-facing
 * phases, preserving each step's original relative order within its phase.
 * A step absent from the given packet (e.g. icu_rn has no jcaho_review)
 * simply never appears in any phase's `steps` — never padded, never
 * assumed present.
 */
export function groupStepsIntoPhases(steps: StepDisplayItem[]): OnboardingPhaseGroup[] {
  const buckets: Record<OnboardingPhaseId, StepDisplayItem[]> = {
    about_you: [],
    authorizations: [],
    pay_health_documents: [],
    safety_review: [],
  };

  for (const step of steps) {
    const phaseId = STEP_ID_TO_PHASE[step.id];
    if (!phaseId) {
      throw new Error(`groupStepsIntoPhases: step "${step.id}" has no configured onboarding phase — add it to STEP_ID_TO_PHASE in phases.ts`);
    }
    buckets[phaseId].push(step);
  }

  return ONBOARDING_PHASES.map((def) => ({ ...def, steps: buckets[def.id] }));
}

export type PhaseStatus = 'completed' | 'in_progress' | 'not_started';

export interface PhaseRequiredCounts {
  completedRequired: number;
  totalRequired: number;
}

/** Required-step counts only — an incomplete optional step never appears in
 * either number, so it can never make a phase whose required work is done
 * look incomplete (§9). */
export function derivePhaseRequiredCounts(phaseSteps: StepDisplayItem[]): PhaseRequiredCounts {
  const required = phaseSteps.filter((s) => s.required);
  return {
    completedRequired: required.filter((s) => s.completed).length,
    totalRequired: required.length,
  };
}

/**
 * Derives a phase's status from the same authoritative step data the rest
 * of the app already uses — never a second completion engine:
 *  - completed: every REQUIRED step in the phase is completed (an
 *    incomplete optional step never blocks this).
 *  - in_progress: not yet complete, but at least one step in the phase
 *    (required or optional) has real activity — completed or in_progress
 *    per the raw session.stepStates value.
 *  - not_started: no step in the phase has any recorded activity.
 * `stepStates` is the session's own raw per-step lifecycle map
 * (session.stepStates from steps.ts's deriveProgress input) — the only
 * place "in progress" (as opposed to merely "not completed") can be told
 * apart, since StepDisplayItem.completed is already a collapsed boolean.
 */
export function derivePhaseStatus(phaseSteps: StepDisplayItem[], stepStates: Partial<Record<string, StepStatus>>): PhaseStatus {
  const { completedRequired, totalRequired } = derivePhaseRequiredCounts(phaseSteps);
  if (totalRequired === 0 || completedRequired === totalRequired) return 'completed';

  const hasActivity = phaseSteps.some((s) => {
    const raw = stepStates[s.id];
    return raw === 'completed' || raw === 'in_progress';
  });
  return hasActivity ? 'in_progress' : 'not_started';
}

/**
 * The phase containing the authoritative next-required-step
 * (progress.nextStep, from steps.ts's own resolveNextRequiredStep-backed
 * derivation) — never a second "what's next" algorithm. Null once
 * progress.nextStep itself is null (every required step across every
 * phase is complete).
 */
export function findCurrentPhaseId(phases: OnboardingPhaseGroup[], nextStepId: string | null | undefined): OnboardingPhaseId | null {
  if (!nextStepId) return null;
  return phases.find((phase) => phase.steps.some((s) => s.id === nextStepId))?.id ?? null;
}
