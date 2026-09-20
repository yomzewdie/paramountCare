import { Text } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';

interface ContinueOnboardingCardProps {
  /** progress.nextStep.label — the authoritative next-required-step's own
   * label, never a second "what's next" computation. */
  stepLabel: string;
  /** The phase (from phases.ts) that step belongs to. */
  phaseLabel: string;
  onPress: () => void;
}

export function ContinueOnboardingCard({ stepLabel, phaseLabel, onPress }: ContinueOnboardingCardProps) {
  const theme = useTheme();
  return (
    <Card style={{ marginBottom: theme.spacing.lg }}>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>
        Continue where you left off
      </Text>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{stepLabel}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>{phaseLabel}</Text>
      <Button label="Continue →" onPress={onPress} />
    </Card>
  );
}
