import {
  defaultFormData,
  getPacket,
  isPacketComplete,
  isStepValid,
  resolveNextRequiredStep,
  type OnboardingFormData,
  type OnboardingPacket,
  type StepStates,
} from '@pcs/shared';

// Derives dashboard-presentation data from the shared packet definition +
// the session's authoritative step_states — deliberately NOT a second copy
// of packet/step data (M4 instructions §9). Reuses @pcs/shared's own
// resolveNextRequiredStep()/isPacketComplete() for "what's next"/"is the
// applicant done" rather than re-implementing that logic here (§10 —
// prefer existing shared business logic).
//
// M10: previously used resolveCurrentStep(), which returns the first
// incomplete step regardless of `required` — meaning an incomplete
// OPTIONAL step (e.g. Travel RN's employment_ref_3) would incorrectly
// surface as "next step" and keep isComplete false even after every
// REQUIRED step was done. Switched to resolveNextRequiredStep() (added in
// packages/shared alongside resolveCurrentStep, not replacing it — see
// ADR-022) and isPacketComplete() (already required-aware, already used
// server-side) so the dashboard's "what do I need to do next" answer and
// "am I done" state are both genuinely required-aware.

export interface StepDisplayItem {
  id: string;
  label: string;
  completed: boolean;
  /** Straight from the packet's own PacketStep.required — lets the UI mark
   * a step "Optional" using real domain data, never a hardcoded id check. */
  required: boolean;
}

export interface OnboardingProgress {
  packetName: string;
  steps: StepDisplayItem[];
  completedSteps: StepDisplayItem[];
  remainingSteps: StepDisplayItem[];
  nextStep: StepDisplayItem | null;
  isComplete: boolean;
}

/** Returns null when the session references a packetId the shared package
 * doesn't know about — should not happen (the Worker validates packetId at
 * session-creation time), but a mobile app talking to a Worker deployed from
 * a different revision of packages/shared should degrade safely rather than
 * throw. */
/**
 * Step statuses as the applicant should SEE them: a step stored as
 * 'completed' counts only if it still passes the CURRENT shared validation —
 * the exact check the Worker's final submission applies
 * (services/submission.ts: `stepStates[id] !== 'completed' ||
 * !isStepValid(...)`). A step completed under older rules (e.g. a pre-UAT
 * Employment Application, or a reference without Supervisor Title) stays
 * 'completed' in storage — the Worker deliberately keeps accepting saves for
 * such sessions — but is shown here as 'in_progress' so Home and Review
 * never claim it's done while Submit would reject it. Derived only: the
 * stored stepStates/formData are never modified.
 */
export function effectiveStepStates(
  packet: OnboardingPacket,
  stepStates: StepStates,
  formDataRaw: Record<string, unknown>,
): StepStates {
  // Same shallow default-merge the Worker uses before validating.
  const formData = { ...defaultFormData, ...formDataRaw } as unknown as OnboardingFormData;
  const effective: StepStates = { ...stepStates };
  for (const step of packet.steps) {
    if (step.type === 'review' || stepStates[step.id] !== 'completed') continue;
    if (!isStepValid(step.id, formData, step)) effective[step.id] = 'in_progress';
  }
  return effective;
}

/** `formData`, when given, applies effectiveStepStates() (the session's
 * current answers re-checked against the current rules); without it the
 * stored statuses are used as-is. */
export function deriveProgress(
  packetId: string,
  stepStatesRaw: Record<string, string>,
  formData?: Record<string, unknown>,
): OnboardingProgress | null {
  const packet = getPacket(packetId);
  if (!packet) return null;

  // The Worker only ever writes values validated against the same
  // StepStatus enum this type describes (see worker/src/schemas/sessions.ts
  // stepStatusSchema) — the session response's stepStates is loosely typed
  // as Record<string, string> only because it round-tripped through JSON.
  const storedStepStates = stepStatesRaw as StepStates;
  const stepStates = formData ? effectiveStepStates(packet, storedStepStates, formData) : storedStepStates;

  const steps: StepDisplayItem[] = packet.steps.map((step) => ({
    id: step.id,
    label: step.label,
    completed: stepStates[step.id] === 'completed',
    required: step.required,
  }));

  const nextPacketStep = resolveNextRequiredStep(packet, stepStates);
  const nextStep = nextPacketStep ? (steps.find((s) => s.id === nextPacketStep.id) ?? null) : null;

  return {
    packetName: packet.name,
    steps,
    completedSteps: steps.filter((s) => s.completed),
    remainingSteps: steps.filter((s) => !s.completed),
    nextStep,
    isComplete: isPacketComplete(packet, stepStates),
  };
}
