import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

interface StepActionBarProps {
  onSaveProgress: () => void;
  onComplete: () => void;
  isSaving: boolean;
  isCompleting: boolean;
  /** e.g. "Continue" — the packet may call the next action something more
   * specific later; kept as a prop rather than hardcoded. */
  completeLabel?: string;
  /** e.g. offline — disables both actions without implying either is mid-save. */
  disabled?: boolean;
}

/** The Save Progress / Continue action row every step screen ends with.
 * Each button's own `loading` prop (not a single shared boolean) is what
 * makes duplicate-tap protection and "which action is in flight" honest —
 * tapping Save Progress must not make Continue look like it's loading too. */
export function StepActionBar({ onSaveProgress, onComplete, isSaving, isCompleting, completeLabel = 'Continue', disabled }: StepActionBarProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Button label={completeLabel} onPress={onComplete} loading={isCompleting} disabled={disabled || isSaving} />
      <Button label="Save Progress" variant="secondary" onPress={onSaveProgress} loading={isSaving} disabled={disabled || isCompleting} />
    </View>
  );
}
