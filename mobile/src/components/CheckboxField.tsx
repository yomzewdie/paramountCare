import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface CheckboxFieldProps {
  label: string;
  /** M15: an optional second line of detail below the label — e.g. a
   * safety topic's title (`label`) plus its full description
   * (`description`). Omitted entirely, this renders byte-identical to the
   * original single-line checkbox (Employment Reference's own consent
   * checkbox, unchanged). The accessible name always reads both together
   * ("title. description"), never just the bold title alone, so a screen
   * reader user gets the full acknowledgement context in one announcement. */
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  error?: string;
}

/**
 * A single labeled consent checkbox — distinct from YesNoField (a two-option
 * choice between two answers): this is one statement the applicant either
 * affirms or doesn't. Needed for Employment Reference's "I give permission
 * to contact this employer" consent; reusable for any future single-consent
 * acknowledgement that isn't a full signed statement (that path already
 * exists via the `acknowledgement` step type / AcknowledgementSection on web).
 * Extended in M15 with an optional `description` for topic-style checklists
 * (Safety & Education) rather than building a second, near-identical
 * checkbox component.
 */
export function CheckboxField({ label, description, value, onChange, error }: CheckboxFieldProps) {
  const theme = useTheme();

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Pressable
        onPress={() => onChange(!value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        accessibilityLabel={description ? `${label}. ${description}` : label}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.sm,
          minHeight: theme.minTouchTarget,
          padding: theme.spacing.sm,
          borderRadius: theme.radii.sm,
          borderWidth: 1,
          borderColor: value ? theme.colors.primary : error ? theme.colors.danger : theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            marginTop: 2,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: value ? theme.colors.primary : theme.colors.border,
            backgroundColor: value ? theme.colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value ? <Text style={{ color: theme.colors.surface, fontSize: 14, fontWeight: '700' }}>{'✓'}</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[description ? theme.typography.bodyStrong : theme.typography.body, { color: theme.colors.text }]}>{label}</Text>
          {description ? (
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>{description}</Text>
          ) : null}
        </View>
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
