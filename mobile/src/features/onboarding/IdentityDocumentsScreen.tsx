import { Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { DocumentSlotCard } from '../../components/DocumentSlotCard';
import { useTheme } from '../../theme/ThemeProvider';
import { useStepNavigation } from './stepNavigation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useIdentityDocumentsForm } from './useIdentityDocumentsForm';

/**
 * Identity Documents — Paramount Care's own onboarding requirement (Driver's
 * License and Social Security Card), shown just before the federal Form I-9
 * document selection and worded so the two are never confused: these are
 * not "I-9 documents", and nothing here depends on citizenship status. The
 * I-9 step can reuse these uploads, but only if the applicant chooses to.
 *
 * No unsaved-changes guard: every upload persists itself the moment it
 * succeeds, so leaving this screen can never discard anything.
 */
export default function IdentityDocumentsScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
  const { isConnected } = useNetworkStatus();
  const form = useIdentityDocumentsForm();

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') nav.leave();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') nav.afterComplete();
  }

  return (
    <Screen
      footer={
        <>
          <FormFooterStatus saveError={form.saveError} isConnected={isConnected} />
          <StepActionBar
            completeLabel={form.isCompleted ? 'Save' : 'Continue'}
            onSaveProgress={handleSaveProgress}
            onComplete={handleComplete}
            isSaving={form.isSaving}
            isCompleting={form.isCompleting}
            disabled={!isConnected}
          />
        </>
      }
    >
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Identity Documents</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
        Paramount Care requires a copy of your Driver&apos;s License and Social Security Card as part of onboarding.
      </Text>
      <Text testID="identity-documents-i9-note" style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
        This is separate from Form I-9. In the next document step you&apos;ll choose your I-9 documents under the federal rules — and if these documents apply,
        you can use the copies you upload here instead of uploading them again.
      </Text>
      <Text accessibilityLiveRegion="polite" style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        {form.uploadedCount} of {form.totalCount} documents uploaded
      </Text>

      {form.slots.map((slot) => (
        <View key={slot.docType} style={{ marginBottom: theme.spacing.sm }}>
          <DocumentSlotCard
            slot={{ label: slot.label, description: slot.description }}
            hook={form.slotHooks[slot.docType]}
            required
            error={form.errors[slot.formDataField]}
          />
        </View>
      ))}
    </Screen>
  );
}
