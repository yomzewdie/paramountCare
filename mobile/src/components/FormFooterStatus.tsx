import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ErrorState } from './StatusStates';

interface FormFooterStatusProps {
  saveError?: string | null;
  isConnected: boolean;
}

/** The save-error banner + offline notice every step screen already showed
 * just above its action buttons — byte-for-byte identical across every one
 * of them, so extracted here rather than repeated. Lives inside each
 * screen's sticky `footer` (see Screen.tsx), directly above its
 * StepActionBar/Submit button, so the applicant always sees why a save
 * failed right next to the action they just took — no scrolling required. */
export function FormFooterStatus({ saveError, isConnected }: FormFooterStatusProps) {
  const theme = useTheme();
  return (
    <>
      {saveError ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <ErrorState message={saveError} />
        </View>
      ) : null}
      {!isConnected ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[theme.typography.caption, { color: theme.colors.warning, textAlign: 'center', marginBottom: theme.spacing.sm }]}
        >
          You&rsquo;re offline — connect to the internet to save.
        </Text>
      ) : null}
    </>
  );
}
