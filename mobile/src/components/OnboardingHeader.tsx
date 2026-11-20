import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { ProgressBar } from './ProgressBar';

interface OnboardingHeaderProps {
  /** The phase (see phases.ts) this step belongs to — e.g. "Pay, Health &
   * Documents". Replaces the old global "Step X of 19" framing: the
   * applicant now sees their position within the current phase, not the
   * full packet's raw step count (4-phase journey pass). */
  phaseLabel: string;
  stepNumber: number;
  totalSteps: number;
  onBack: () => void;
  /** The previous step's label and how to open it — omitted on the first
   * step, after submission, and when the step was opened from Review. */
  previousLabel?: string;
  onPrevious?: () => void;
}

/** Replaces the native Stack header on every onboarding step screen.
 * Reuses ProgressBar, the same progress component the dashboard and
 * onboarding index already use, so there is only ever one completion
 * formula in the app. Deliberately does not repeat the step's own heading
 * text — every step screen already renders its own prominent title as its
 * first content element (e.g. "Form I-9 (Section 1)"), so this header
 * would otherwise duplicate it. Providing a custom `header` loses the
 * native back button, so this renders its own. */
export function OnboardingHeader({ phaseLabel, stepNumber, totalSteps, onBack, previousLabel, onPrevious }: OnboardingHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const percent = totalSteps > 0 ? (stepNumber / totalSteps) * 100 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={[styles.backButton, { minHeight: theme.minTouchTarget }]}
        >
          <Text style={[styles.backLabel, { color: theme.colors.primary }]}>‹ Back</Text>
        </Pressable>
        {onPrevious ? (
          <Pressable
            onPress={onPrevious}
            accessibilityRole="button"
            accessibilityLabel={previousLabel ? `Previous step: ${previousLabel}` : 'Previous step'}
            hitSlop={8}
            testID="previous-step"
            style={[styles.backButton, { minHeight: theme.minTouchTarget }]}
          >
            <Text style={[styles.previousLabel, { color: theme.colors.primary }]}>Previous step</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]} numberOfLines={1}>
          {phaseLabel}
        </Text>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
          Step {stepNumber} of {totalSteps}
        </Text>
        <ProgressBar percent={percent} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  backLabel: { fontSize: 17, fontWeight: '600' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previousLabel: { fontSize: 15, fontWeight: '600' },
});
