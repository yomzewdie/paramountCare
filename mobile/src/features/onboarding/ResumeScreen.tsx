import { Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { DocumentSlotCard } from '../../components/DocumentSlotCard';
import { useTheme } from '../../theme/ThemeProvider';
import { useStepNavigation } from './stepNavigation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { RESUME_SLOT } from '../documents/documentSlots';
import { useResumeForm } from './useResumeForm';

export default function ResumeScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
  const { isConnected } = useNetworkStatus();
  const form = useResumeForm();

  // No unsaved-changes guard: the resume persists itself the moment it's
  // uploaded, so leaving this screen can never discard anything.

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Upload Your Resume</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Your resume tells us about your work history and clinical experience, so you won&rsquo;t need to type it in. Upload your current resume as a PDF or Word document (DOC or DOCX). Recruiters review your work history directly from it.
      </Text>

      <DocumentSlotCard slot={RESUME_SLOT} hook={form.slot} required documentOnly error={form.errors.resumeDocument} />

      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.sm }]}>
        Your resume is stored securely and shared only with Paramount Care Staffing recruiters reviewing your application.
      </Text>
    </Screen>
  );
}
