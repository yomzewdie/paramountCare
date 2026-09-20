import { Linking, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { FaqItem } from '../../src/components/FaqItem';
import { useTheme } from '../../src/theme/ThemeProvider';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_SPOKEN, SUPPORT_PHONE_TEL_URI, SUPPORT_HOURS_LINES, FAQ_ITEMS } from '../../src/features/help/helpContent';

// Applicant support — a real phone number + hours, and six FAQ answers,
// nothing invented beyond what was given (no email, no coordinator name, no
// response-time promise, no after-hours/weekend availability). No backend
// call, no CMS — FAQ_ITEMS/support info are a small static config
// (helpContent.ts). Deliberately no large Paramount Care logo here, and no
// contextual per-form Help entry points in this pass.
export default function Help() {
  const theme = useTheme();

  return (
    <Screen>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Help</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Need assistance with your onboarding? We&rsquo;re here to help.
      </Text>

      <Card style={{ marginBottom: theme.spacing.lg }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Need help?</Text>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>Call Paramount Care</Text>
        <Text style={[theme.typography.title, { color: theme.colors.primary, marginBottom: theme.spacing.sm }]}>{SUPPORT_PHONE_DISPLAY}</Text>
        {SUPPORT_HOURS_LINES.map((line) => (
          <Text key={line} style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{line}</Text>
        ))}
        <View style={{ marginTop: theme.spacing.md }}>
          <Button
            label={`Call ${SUPPORT_PHONE_DISPLAY}`}
            accessibilityLabel={`Call Paramount Care at ${SUPPORT_PHONE_SPOKEN}`}
            accessibilityHint="Opens your phone app to call Paramount Care"
            onPress={() => void Linking.openURL(SUPPORT_PHONE_TEL_URI)}
          />
        </View>
      </Card>

      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Frequently Asked Questions</Text>
      <Card>
        {FAQ_ITEMS.map((item) => (
          <FaqItem key={item.id} question={item.question} answer={item.answer} />
        ))}
      </Card>
    </Screen>
  );
}
