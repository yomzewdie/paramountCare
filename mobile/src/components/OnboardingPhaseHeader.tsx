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
  /** Makes "Continue →" itself tappable, opening the phase's next step. It
   * is its own button beside the row — never nested inside the row's own
   * pressable — so the two touch targets (and their screen-reader
   * elements) never conflict. */
  onContinue?: () => void;
}

const STATUS_WORDS: Record<PhaseStatus, string> = {
  completed: 'Complete',
  in_progress: 'In progress',
  not_started: 'Not started',
};

/** Never conveys phase status by glyph/color alone — accessibilityLabel
 * below states it in words, and the glyph shape itself (✓ / ● / ○) differs,
 * not just its color, matching StepRow's own established convention. */
export function OnboardingPhaseHeader({ label, status, completedRequired, totalRequired, isCurrent, onPress, expanded, onContinue }: OnboardingPhaseHeaderProps) {
  const theme = useTheme();

  const glyph = status === 'completed' ? '✓' : status === 'in_progress' ? '●' : '○';
  const glyphColor = status === 'completed' ? theme.colors.success : status === 'in_progress' ? theme.colors.primary : theme.colors.textMuted;
  const statusLine = status === 'in_progress' ? `${completedRequired} of ${totalRequired} complete` : STATUS_WORDS[status];

  const interactive = !!onPress;
  const continueButton = !!(isCurrent && onContinue);
  const a11yLabel = [label, STATUS_WORDS[status], isCurrent && !continueButton ? 'continue here' : null, interactive ? (expanded ? 'expanded' : 'collapsed') : null]
    .filter(Boolean)
    .join(', ');

  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingTop: theme.spacing.sm, paddingBottom: continueButton ? 0 : theme.spacing.sm }}>
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ fontSize: 20, width: 26, color: glyphColor }}>
        {glyph}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 2 }]}>{statusLine}</Text>
        {isCurrent && !continueButton ? (
          <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700', marginTop: 2 }]}>Continue →</Text>
        ) : null}
      </View>
      {interactive ? (
        <Text accessibilityElementsHidden style={{ color: theme.colors.textMuted, fontSize: 18 }}>{expanded ? '⌄' : '›'}</Text>
      ) : null}
    </View>
  );

  const header = interactive ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ expanded }}
      hitSlop={4}
      style={({ pressed }) => [{ minHeight: continueButton ? undefined : theme.minTouchTarget, justifyContent: 'center', opacity: pressed ? 0.7 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={a11yLabel}>
      {content}
    </View>
  );

  if (!continueButton) return header;

  return (
    <View>
      {header}
      <Pressable
        onPress={onContinue}
        accessibilityRole="button"
        accessibilityLabel={`Continue ${label}`}
        accessibilityHint="Opens your next onboarding step in this section"
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 24 }}
        testID="phase-continue"
        style={({ pressed }) => [{ alignSelf: 'flex-start', marginLeft: 26, minHeight: 36, paddingTop: 2, paddingBottom: theme.spacing.sm, justifyContent: 'flex-start', opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '700' }]}>Continue →</Text>
      </Pressable>
    </View>
  );
}
