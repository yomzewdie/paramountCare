import { useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { Screen } from '../../components/Screen';
import { DocumentSlotCard } from '../../components/DocumentSlotCard';
import { TextField } from '../../components/TextField';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useVaccineDeclinationForm } from './useVaccineDeclinationForm';

// Per-vaccine descriptive copy — approved text copied verbatim from the
// existing web VaccineDeclinationSection.tsx's own VACCINE_META object
// (not invented here). hep_b_declination (M13), tdap_declination (M14),
// and flu_declination (M15) are all structurally identical in the source —
// same decision values, same checkbox+signature declining path, same
// REQUIRED proof-upload on the providing-proof path — confirmed by direct
// comparison each time, not assumed from all three being vaccine
// declinations. Only their copy differs. The fallback
// below (matching web's own fallback shape) keeps the screen functional if
// any future vaccine step is registered before its own metadata is added
// here.
const VACCINE_META: Record<string, { riskContext: string; offerStatement: string; declinationQuestion: string; proofInstructions: string; acceptableDocs: string }> = {
  hep_b_declination: {
    riskContext:
      'Due to occupational exposure to blood or other potentially infectious materials, healthcare workers may be at risk of acquiring Hepatitis B virus (HBV) infection. The Hepatitis B vaccine series is highly effective at preventing HBV infection.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the Hepatitis B vaccine series at no charge, as required by OSHA’s Bloodborne Pathogens Standard (29 CFR 1910.1030).',
    declinationQuestion: 'Are you declining the Hepatitis B vaccination at this time?',
    proofInstructions:
      'Please provide documentation confirming you have received or are in the process of receiving the Hepatitis B vaccine series, or laboratory evidence of immunity (anti-HBs titer). Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record from a healthcare provider, vaccination card, or a positive hepatitis B surface antibody (HBsAb) titer report',
  },
  tdap_declination: {
    riskContext:
      'Pertussis (whooping cough) can be life-threatening for vulnerable patients including infants and immunocompromised individuals. Healthcare workers are at increased risk of transmitting pertussis to patients in their care.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the Tdap vaccine, as recommended by the CDC and the Advisory Committee on Immunization Practices (ACIP) for all healthcare personnel who have not previously received Tdap as an adult.',
    declinationQuestion: 'Are you declining the Tdap vaccination at this time?',
    proofInstructions:
      'Please provide documentation confirming you have received the Tdap vaccine (within the past 10 years). Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record, vaccination card, or a healthcare provider letter confirming Tdap administration and date',
  },
  flu_declination: {
    riskContext:
      'Influenza causes serious illness and death each year, particularly in the elderly, infants, and immunocompromised patients — populations commonly encountered in clinical assignments. Unvaccinated healthcare workers are a documented source of patient transmission.',
    offerStatement:
      'Paramount Care Staffing, LLC has offered you the seasonal Influenza/H1N1 vaccine, as recommended annually by the CDC and ACIP for all healthcare workers. Note: some client facilities require annual influenza vaccination as a condition of placement.',
    declinationQuestion: 'Are you declining the seasonal Influenza/H1N1 vaccination at this time?',
    proofInstructions:
      'Please provide documentation confirming you have received the current-season influenza vaccine. Proof must be submitted prior to your first clinical assignment.',
    acceptableDocs:
      'Immunization record, pharmacy vaccination receipt, vaccination card, or a healthcare provider letter confirming flu vaccination and date',
  },
};

function paragraphsOf(text: string): string[] {
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

export default function VaccineDeclinationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const { stepId } = useLocalSearchParams<{ stepId: string }>();
  const form = useVaccineDeclinationForm(stepId ?? '');

  const meta = VACCINE_META[stepId ?? ''] ?? {
    riskContext: '',
    offerStatement: '',
    declinationQuestion: `Are you declining the ${form.heading}?`,
    proofInstructions: 'Please provide documentation confirming your vaccination status.',
    acceptableDocs: 'Immunization record or vaccination card',
  };

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const signatureRef = useRef<TextInput>(null);
  const proofOffset = useRef<number | undefined>(undefined);

  function scrollToProofError() {
    if (proofOffset.current !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, proofOffset.current - 24), animated: true });
  }

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') router.back();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') router.back();
    else if (outcome.kind === 'invalid' && form.data.decision === 'providing_proof') scrollToProofError();
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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{form.heading}</Text>

      {form.conflict ? (
        <View style={{ marginBottom: theme.spacing.lg }}>
          <ErrorState message="Newer onboarding data was found for your account. Your changes on this screen have not been lost — choose how to continue." />
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Button label="Keep my changes and retry" onPress={form.keepMyChanges} />
            <Button label="Discard my changes and show the latest" variant="secondary" onPress={form.discardAndReloadLatest} />
          </View>
        </View>
      ) : null}

      {(meta.riskContext || meta.offerStatement) ? (
        <FormSection title="About This Requirement">
          {meta.riskContext ? (
            <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>{meta.riskContext}</Text>
          ) : null}
          {meta.offerStatement ? (
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>{meta.offerStatement}</Text>
          ) : null}
        </FormSection>
      ) : null}

      <FormSection title="Your Decision">
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{meta.declinationQuestion}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>Select one — this decision is required to proceed.</Text>

        <View style={{ gap: theme.spacing.sm }}>
          <Button
            label="Yes — I am declining (read the statement and sign below)"
            variant={form.data.decision === 'declining' ? 'primary' : 'secondary'}
            onPress={() => form.setDecision('declining')}
          />
          <Button
            label="No — I am providing proof of vaccination"
            variant={form.data.decision === 'providing_proof' ? 'primary' : 'secondary'}
            onPress={() => form.setDecision('providing_proof')}
          />
        </View>
        {form.errors.decision ? (
          <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.sm }]}>{form.errors.decision}</Text>
        ) : null}
      </FormSection>

      {form.data.decision === 'declining' ? (
        <FormSection title="Declination Statement">
          <View
            accessibilityRole="text"
            style={{
              maxHeight: 280,
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
                <Text key={i} style={[theme.typography.body, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>{para}</Text>
              ))}
            </ScrollView>
          </View>

          <CheckboxField
            label={`I have read and understand the above declination statement. I voluntarily decline ${form.heading} vaccination at this time and acknowledge all risks associated with declining this vaccine.`}
            value={form.data.checked}
            onChange={form.toggleChecked}
            error={form.errors.checked}
          />

          {form.requiresSignature ? (
            <>
              <TextField
                ref={signatureRef}
                label="Electronic Signature"
                required
                placeholder="Type your full legal name to sign"
                value={form.data.typedSignature}
                onChangeText={form.setTypedSignature}
                onBlur={() => form.blurField('typedSignature')}
                error={form.errors.typedSignature}
                autoCapitalize="words"
                returnKeyType="done"
              />
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: -theme.spacing.sm }]}>
                By typing your name you are electronically signing this declination. Your signature carries the same legal weight as a handwritten signature and will be retained in your occupational health record.
              </Text>
            </>
          ) : null}
        </FormSection>
      ) : null}

      {form.data.decision === 'providing_proof' ? (
        <View onLayout={(e: LayoutChangeEvent) => { proofOffset.current = e.nativeEvent.layout.y; }}>
          <FormSection title="Vaccination Proof">
            <Text style={[theme.typography.body, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>{meta.proofInstructions}</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
              Acceptable documents: {meta.acceptableDocs}. Originals or certified copies may be requested at the time of your orientation or first assignment.
            </Text>
            <DocumentSlotCard
              slot={{ label: 'Upload vaccination proof' }}
              hook={form.proofSlot}
              required
              error={form.errors.vaccineProofDocument}
            />
          </FormSection>
        </View>
      ) : null}

    </Screen>
  );
}
