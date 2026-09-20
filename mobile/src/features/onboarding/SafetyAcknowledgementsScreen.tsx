import { useRef } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState, SuccessState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { SAFETY_TOPIC_KEYS, useSafetyAcknowledgementsForm } from './useSafetyAcknowledgementsForm';

// Topic copy is copied verbatim from the existing web SafetySection.tsx's
// own SAFETY_TOPICS array — not paraphrased, since this is legally
// significant acknowledgement text the applicant is attesting to having
// read. See ADR-028 for why this step is a fixed 8-topic checklist rather
// than the generic AcknowledgementEntry model used elsewhere.
const SAFETY_TOPICS: Record<(typeof SAFETY_TOPIC_KEYS)[number], { title: string; description: string }> = {
  patientSafety: {
    title: 'Patient Safety & Fall Prevention',
    description:
      'I understand fall risk assessment procedures, bed rail policies, call light placement, and patient identification protocols. I will apply appropriate fall prevention interventions for all patients in my care.',
  },
  infectionControl: {
    title: 'Infection Control & Standard Precautions',
    description:
      'I understand and will comply with standard precautions including proper hand hygiene, appropriate use of PPE, isolation precaution categories (Contact, Droplet, Airborne), and correct donning/doffing procedures.',
  },
  fireSafety: {
    title: 'Fire Safety & Emergency Response',
    description:
      'I understand the RACE protocol (Rescue, Alarm, Contain, Extinguish) and PASS technique (Pull, Aim, Squeeze, Sweep). I know facility emergency codes, evacuation procedures, and my assigned responsibilities.',
  },
  patientRightsHipaa: {
    title: 'Patient Rights, Privacy & HIPAA',
    description:
      'I understand patient rights including the right to informed consent, advance directives, and confidentiality. I will comply with all HIPAA Privacy and Security Rule requirements and will not disclose protected health information improperly.',
  },
  workplaceViolence: {
    title: 'Workplace Violence Prevention',
    description:
      'I understand the facility zero-tolerance policy on workplace violence. I am familiar with de-escalation techniques, how to identify warning signs, and the proper channels for reporting threatening or violent behavior.',
  },
  backSafety: {
    title: 'Body Mechanics & Safe Patient Handling',
    description:
      'I understand proper body mechanics for safe patient care, including correct lifting techniques, use of assistive devices and mechanical lifts, and procedures for repositioning or transferring patients to prevent injury.',
  },
  hazardousMaterials: {
    title: 'Hazardous Materials & Bloodborne Pathogens',
    description:
      'I understand OSHA Bloodborne Pathogen standards, proper handling and disposal of sharps and biohazardous waste, Safety Data Sheet (SDS) access, and the post-exposure protocol in the event of a needlestick or body fluid exposure.',
  },
  documentationStandards: {
    title: 'Documentation & Mandatory Reporting',
    description:
      'I understand the standards for accurate, timely, and complete medical documentation. I am aware of my mandatory reporting obligations, including reporting of abuse, neglect, incidents, and safety concerns through proper channels.',
  },
};

export default function SafetyAcknowledgementsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useSafetyAcknowledgementsForm();

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') router.back();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') router.back();
  }

  return (
    <Screen
      ref={scrollRef}
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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Safety & Education Exam</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
        Paramount Care Staffing, LLC — Safety & Education Orientation
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

      <FormSection title="Before You Begin">
        <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          Review each safety topic below and acknowledge that you have read, understood, and will comply with the policies and
          procedures covered in the Paramount Care Staffing Safety & Education Exam. You will complete a 25-question written
          exam during your in-person orientation.
        </Text>
      </FormSection>

      <View style={{ marginBottom: theme.spacing.md }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
          {form.topicsChecked} of {form.totalTopics} topics acknowledged
        </Text>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: form.totalTopics, now: form.topicsChecked }}
          style={{ height: 8, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}
        >
          <View
            style={{
              height: '100%',
              width: `${(form.topicsChecked / form.totalTopics) * 100}%`,
              borderRadius: theme.radii.full,
              backgroundColor: theme.colors.primary,
            }}
          />
        </View>
      </View>

      <FormSection title="Safety Topics">
        {SAFETY_TOPIC_KEYS.map((key) => (
          <CheckboxField
            key={key}
            label={SAFETY_TOPICS[key].title}
            description={SAFETY_TOPICS[key].description}
            value={form.data[key]}
            onChange={() => form.toggleTopic(key)}
          />
        ))}
        {form.errors._topics ? (
          <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
            {form.errors._topics}
          </Text>
        ) : null}
      </FormSection>

      {form.allTopicsChecked ? (
        <FormSection title="Attestation">
          <CheckboxField
            label="Safety & Education Exam Attestation"
            description="I confirm that I have reviewed all safety and education topics listed above. I understand that I will complete the 25-question Safety & Education Exam during my in-person orientation with Paramount Care Staffing, LLC. I agree to comply with all safety policies and procedures at all facilities where I am placed."
            value={form.data.examAttestation}
            onChange={form.toggleAttestation}
            error={form.errors.examAttestation}
          />
        </FormSection>
      ) : null}

      {form.data.examAttestation ? (
        <View style={{ marginBottom: theme.spacing.md }}>
          <SuccessState message="Safety & Education orientation complete. Thank you for your commitment to a safe workplace." />
        </View>
      ) : null}

    </Screen>
  );
}
