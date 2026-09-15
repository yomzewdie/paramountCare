import { useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useAcknowledgementForm } from './useAcknowledgementForm';

// Splits the statement's paragraphs on a double newline — the exact same
// approach the existing web AcknowledgementSection.tsx uses to render
// multi-paragraph legal text. The text itself always comes from the
// current session's packet step config (useAcknowledgementForm reads it
// live), never hardcoded here, since both wording AND which step this is
// vary — this single screen now serves Application Statement, Background
// Authorization, and any future acknowledgement step confirmed to share
// the same { checked, typedSignature, signedAt } model (see ADR-022).
function paragraphsOf(text: string): string[] {
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

export default function AcknowledgementScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const { stepId } = useLocalSearchParams<{ stepId: string }>();
  const form = useAcknowledgementForm(stepId ?? '');

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const checkboxOffset = useRef<number | undefined>(undefined);
  const signatureRef = useRef<TextInput>(null);
  const signatureOffset = useRef<number | undefined>(undefined);

  function scrollToFirstError() {
    if (form.errors.checked && checkboxOffset.current !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, checkboxOffset.current - 24), animated: true });
    } else if (form.errors.typedSignature && signatureOffset.current !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, signatureOffset.current - 24), animated: true });
      signatureRef.current?.focus();
    }
  }

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') router.back();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') {
      router.back();
    } else if (outcome.kind === 'invalid') {
      scrollToFirstError();
    }
  }

  return (
    <Screen ref={scrollRef}>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{form.heading}</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Please read the statement below carefully before acknowledging and signing.
      </Text>

      {form.conflict ? (
        <View style={{ marginBottom: theme.spacing.lg }}>
          <ErrorState message="Newer onboarding data was found for your account. Your changes on this screen have not been lost — choose how to continue." />
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Button label="Keep my changes and retry" onPress={form.keepMyChanges} />
            <Button label="Discard my changes and show the latest" variant="secondary" onPress={form.discardAndReloadLatest} />
          </View>
        </View>
      ) : null}

      <FormSection title="Statement">
        <View
          accessibilityRole="text"
          style={{
            maxHeight: 320,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.sm,
            backgroundColor: theme.colors.surface,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.md,
          }}
        >
          <ScrollView nestedScrollEnabled>
            {paragraphsOf(form.statementText).map((para, i) => (
              <Text
                key={i}
                style={[theme.typography.body, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}
              >
                {para}
              </Text>
            ))}
          </ScrollView>
        </View>

        <View onLayout={(e) => { checkboxOffset.current = e.nativeEvent.layout.y; }}>
          <CheckboxField
            label="I have read and understood the above. I acknowledge and agree to the terms stated."
            value={form.data.checked}
            onChange={form.toggleChecked}
            error={form.errors.checked}
          />
        </View>

        {form.requiresSignature ? (
          <View onLayout={(e) => { signatureOffset.current = e.nativeEvent.layout.y; }}>
            <TextField
              ref={signatureRef}
              label="Electronic Signature"
              required
              placeholder="Type your full legal name to sign"
              value={form.data.typedSignature}
              onChangeText={form.setTypedSignature}
              onBlur={form.blurSignature}
              error={form.errors.typedSignature}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }]}>
              By typing your name you are electronically signing this document. Your signature carries the same legal weight as a handwritten signature under applicable law.
            </Text>
            {form.data.typedSignature.trim() ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[theme.typography.caption, { color: theme.colors.success, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }]}
              >
                Signed as: {form.data.typedSignature}
                {form.data.signedAt ? ` · ${new Date(form.data.signedAt).toLocaleString()}` : ''}
              </Text>
            ) : null}
          </View>
        ) : null}
      </FormSection>

      {form.saveError ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <ErrorState message={form.saveError} />
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

      <StepActionBar
        completeLabel={form.isCompleted ? 'Save' : 'Continue'}
        onSaveProgress={handleSaveProgress}
        onComplete={handleComplete}
        isSaving={form.isSaving}
        isCompleting={form.isCompleting}
        disabled={!isConnected}
      />
    </Screen>
  );
}
