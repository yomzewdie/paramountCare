import { getPacket, resolveCurrentStep, type StepStates } from '@pcs/shared';

// Derives dashboard-presentation data from the shared packet definition +
// the session's authoritative step_states — deliberately NOT a second copy
// of packet/step data (M4 instructions §9). Reuses @pcs/shared's own
// resolveCurrentStep() for "what's next" rather than re-implementing that
// logic here (§10 — prefer existing shared business logic).

export interface StepDisplayItem {
  id: string;
  label: string;
  completed: boolean;
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
export function deriveProgress(packetId: string, stepStatesRaw: Record<string, string>): OnboardingProgress | null {
  const packet = getPacket(packetId);
  if (!packet) return null;

  // The Worker only ever writes values validated against the same
  // StepStatus enum this type describes (see worker/src/schemas/sessions.ts
  // stepStatusSchema) — the session response's stepStates is loosely typed
  // as Record<string, string> only because it round-tripped through JSON.
  const stepStates = stepStatesRaw as StepStates;

  const steps: StepDisplayItem[] = packet.steps.map((step) => ({
    id: step.id,
    label: step.label,
    completed: stepStates[step.id] === 'completed',
  }));

  const nextPacketStep = resolveCurrentStep(packet, stepStates);
  const nextStep = nextPacketStep ? (steps.find((s) => s.id === nextPacketStep.id) ?? null) : null;

  return {
    packetName: packet.name,
    steps,
    completedSteps: steps.filter((s) => s.completed),
    remainingSteps: steps.filter((s) => !s.completed),
    nextStep,
    isComplete: nextPacketStep === null,
  };
}
