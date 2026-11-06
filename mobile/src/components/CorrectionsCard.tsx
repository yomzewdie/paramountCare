import { Text, View } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { useTheme } from '../theme/ThemeProvider';
import { needsAction } from '../features/onboarding/CorrectionsContext';
import type { OpenCorrection } from '../features/onboarding/sessionApi';

/** "Action needed": each document a recruiter sent back, why, and a way to fix it. */
export function CorrectionsCard({ corrections, onFix }: { corrections: OpenCorrection[]; onFix: (requirement: string) => void }) {
  const theme = useTheme();
  const open = needsAction(corrections);
  if (open.length === 0) return null;
  return (
    <Card style={{ marginBottom: theme.spacing.lg, borderColor: theme.colors.danger }}>
      <Text accessibilityRole="header" style={[theme.typography.bodyStrong, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
        Action needed
      </Text>
      {open.map((correction, i) => (
        <View key={correction.requirement} style={i > 0 ? { marginTop: theme.spacing.md } : undefined}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{correction.label}</Text>
          {correction.note ? <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>{correction.note}</Text> : null}
          <Button label="Fix Document" onPress={() => onFix(correction.requirement)} accessibilityHint={`Upload a corrected ${correction.label}`} />
        </View>
      ))}
    </Card>
  );
}
