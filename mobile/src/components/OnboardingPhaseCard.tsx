import { useState } from 'react';
import { View } from 'react-native';
import { Card } from './Card';
import { StepRow } from './StepRow';
import { OnboardingPhaseHeader } from './OnboardingPhaseHeader';
import { useTheme } from '../theme/ThemeProvider';
import type { StepStatus } from '@pcs/shared';
import { derivePhaseRequiredCounts, derivePhaseStatus, type OnboardingPhaseGroup } from '../features/onboarding/phases';

interface OnboardingPhaseCardProps {
  phase: OnboardingPhaseGroup;
  isCurrent: boolean;
  /** Raw per-step lifecycle (session.stepStates) — the only source for a
   * step's own Not Started/In Progress/Complete badge inside the expanded
   * body (StepDisplayItem.completed alone can't distinguish the first two).
   * Same data StatusBadge/StepRow already consume elsewhere. */
  stepStates: Partial<Record<string, StepStatus>>;
  defaultExpanded: boolean;
  onStepPress: (stepId: string) => void;
}

/** One collapsible phase container for the Onboarding journey screen.
 * Reuses StepRow for each step inside — no new per-step row component, no
 * second completion/status derivation (see phases.ts's own doc comment). */
export function OnboardingPhaseCard({ phase, isCurrent, stepStates, defaultExpanded, onStepPress }: OnboardingPhaseCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const status = derivePhaseStatus(phase.steps, stepStates);
  const { completedRequired, totalRequired } = derivePhaseRequiredCounts(phase.steps);

  return (
    <Card style={{ marginBottom: theme.spacing.md, borderColor: isCurrent ? theme.colors.primary : theme.colors.border }}>
      <OnboardingPhaseHeader
        label={phase.label}
        status={status}
        completedRequired={completedRequired}
        totalRequired={totalRequired}
        isCurrent={isCurrent}
        expanded={expanded}
        onPress={() => setExpanded((v) => !v)}
      />
      {expanded ? (
        <View style={{ marginTop: theme.spacing.xs, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.spacing.xs }}>
          {phase.steps.map((step) => (
            <StepRow
              key={step.id}
              label={step.label}
              completed={step.completed}
              required={step.required}
              status={stepStates[step.id]}
              onPress={() => onStepPress(step.id)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}
