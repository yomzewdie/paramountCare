import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { PhaseStatus } from '../features/onboarding/phases';

interface OnboardingPhaseHeaderProps {
  label: string;
  status: PhaseStatus;
  completedRequired: number;
  totalRequired: number;
  /** True for the one phase containing the authoritative next-required-step
   * (see findCurrentPhaseId) — shows a "Continue →" affordance regardless
   * of the phase's own status (a current-but-not-yet-started phase still
   * has a next action in it). */
  isCurrent?: boolean;
  /** Omit for a read-only summary row (Home's four-phase overview); provide
   * for a tappable expand/collapse header (the Onboarding tab's phase
   * cards) — same component serves both, same reasoning StepRow already
   * uses for its own onPress prop. */
  onPress?: () => void;
  expanded?: boolean;
}

const STATUS_WORDS: Record<PhaseStatus, string> = {
  completed: 'Complete',
  in_progress: 'In progress',
  not_started: 'Not started',
};

/** Never conveys phase status by glyph/color alone — accessibilityLabel
 * below states it in words, and the glyph shape itself (✓ / ● / ○) differs,
 * not just its color, matching StepRow's own established convention. */
export function OnboardingPhaseHeader({ label, status, completedRequired, totalRequired, isCurrent, onPress, expanded }: OnboardingPhaseHeaderProps) {
  const theme = useTheme();

  const glyph = status === 'completed' ? '✓' : status === 'in_progress' ? '●' : '○';
  const glyphColor = status === 'completed' ? theme.colors.success : status === 'in_progress' ? theme.colors.primary : theme.colors.textMuted;
  const statusLine = status === 'in_progress' ? `${completedRequired} of ${totalRequired} complete` : STATUS_WORDS[status];

  const interactive = !!onPress;
  const a11yLabel = [label, STATUS_WORDS[status], isCurrent ? 'continue here' : null, interactive ? (expanded ? 'expanded' : 'collapsed') : null]
    .filter(Boolean)
    .join(', ');

  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: theme.spacing.sm }}>
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ fontSize: 20, width: 26, color: glyphColor }}>
        {glyph}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 2 }]}>{statusLine}</Text>
        {isCurrent ? (
          <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginTop: 2 }]}>Continue →</Text>
        ) : null}
      </View>
      {interactive ? (
        <Text accessibilityElementsHidden style={{ color: theme.colors.textMuted, fontSize: 18 }}>{expanded ? '⌄' : '›'}</Text>
      ) : null}
    </View>
  );

  if (interactive) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ expanded }}
        hitSlop={4}
        style={({ pressed }) => [{ minHeight: theme.minTouchTarget, justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={a11yLabel}>
      {content}
    </View>
  );
}
