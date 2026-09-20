import { Text } from 'react-native';
import type { StepStatus } from '@pcs/shared';
import { useTheme } from '../theme/ThemeProvider';

// Text (not color alone) for every state, same accessibility principle
// StepRow/ProgressBar already follow. Only renders what the real session
// data (session.stepStates[id], the exact StepStatus enum the Worker
// writes — see @pcs/shared's own doc comment on it) can actually say about
// a step today: not_started/in_progress/completed cover every step type
// currently implemented in this app. 'failed'/'skipped' are handled for
// type-completeness (the enum permits them, for a future exam step) but no
// current step ever produces them. Deliberately does NOT show "Needs
// attention" — that per-step signal doesn't exist in this data model; only
// ReviewScreen's OWN badge legitimately says that, for a different question
// ("does this block submission") that this component isn't answering.
const LABELS: Record<StepStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Complete',
  failed: 'Attention Needed',
  skipped: 'Skipped',
};

interface StatusBadgeProps {
  status: StepStatus;
  /** Straight from the packet's own PacketStep.required (same convention as
   * StepRow/ReviewScreen) — an optional step shows "Optional" instead of
   * its raw lifecycle status, since that is the more useful truth for an
   * applicant deciding what to do next. */
  required?: boolean;
}

export function StatusBadge({ status, required = true }: StatusBadgeProps) {
  const theme = useTheme();

  if (!required) {
    return <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontWeight: '700' }]}>Optional</Text>;
  }

  const color = {
    not_started: theme.colors.textMuted,
    in_progress: theme.colors.primary,
    completed: theme.colors.success,
    failed: theme.colors.danger,
    skipped: theme.colors.textMuted,
  }[status];

  return (
    <Text style={[theme.typography.caption, { color, fontWeight: '700' }]}>{LABELS[status]}</Text>
  );
}
