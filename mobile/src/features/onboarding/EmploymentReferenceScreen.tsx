import { useCallback, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { getPacket, type EmploymentReference } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useStepNavigation } from './stepNavigation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useSession } from './SessionContext';
import { useEmploymentReferenceForm } from './useEmploymentReferenceForm';

// Visual field order — used only to decide where to scroll on a failed
// Complete attempt (same purpose as PersonalInfoScreen's FIELD_ORDER).
// Resume-first: the employment itself (position, dates, employer location)
// is on the resume, so a reference is only who Paramount should contact and
// the applicant's permission to contact them. permissionGranted is included
// for scroll targeting even though it never receives a focus-chain ref.
const FIELD_ORDER: (keyof EmploymentReference)[] = [
  'supervisorName', 'supervisorTitle', 'employerName', 'supervisorPhone', 'supervisorEmail',
  'permissionGranted',
];

export default function EmploymentReferenceScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
  const { isConnected } = useNetworkStatus();
  const { stepId: rawStepId } = useLocalSearchParams<{ stepId: string }>();
  const stepId = rawStepId ?? 'employment_ref_1';
  const { session } = useSession();
  const form = useEmploymentReferenceForm(stepId);

  const referenceNumber = session ? getPacket(session.packetId)?.steps.find((s) => s.id === stepId)?.config?.referenceNumber : undefined;
  const heading = referenceNumber != null ? `Employment Reference #${referenceNumber}` : 'Employment Reference';

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<keyof EmploymentReference, number>>>({});
  const fieldRefs = useRef<Partial<Record<keyof EmploymentReference, TextInput | null>>>({});

  const setFieldRef = useCallback((field: keyof EmploymentReference, r: TextInput | null) => {
    fieldRefs.current[field] = r;
  }, []);
  const setFieldOffset = useCallback((field: keyof EmploymentReference, e: LayoutChangeEvent) => {
    fieldOffsets.current[field] = e.nativeEvent.layout.y;
  }, []);

  function focusNext(field: keyof EmploymentReference) {
    const idx = FIELD_ORDER.indexOf(field);
    const next = FIELD_ORDER[idx + 1];
    if (next) fieldRefs.current[next]?.focus();
  }

  function scrollToFirstError() {
    const firstInvalid = FIELD_ORDER.find((f) => form.errors[f]);
    const y = firstInvalid ? fieldOffsets.current[firstInvalid] : undefined;
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') nav.leave();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') {
      nav.afterComplete();
    } else if (outcome.kind === 'invalid') {
      scrollToFirstError();
    }
  }

  const field = (key: keyof EmploymentReference) => ({
    value: (form.data[key] as string | undefined) ?? '',
    onChangeText: (v: string) => form.setField(key, v as EmploymentReference[typeof key]),
    onBlur: () => form.blurField(key),
    onLayout: (e: LayoutChangeEvent) => setFieldOffset(key, e),
    error: form.errors[key],
    ref: (r: TextInput | null) => setFieldRef(key, r),
  });

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{heading}</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Provide contact details for a clinical supervisor Paramount can contact to verify your employment. Your reference must be someone you reported to directly, such as a Charge RN, RN Supervisor, DON, or Nurse Manager. Your dates and positions come from your resume.
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

      <FormSection title="Reference Contact">
        <TextField label="Supervisor's Name" required autoComplete="off" returnKeyType="next" onSubmitEditing={() => focusNext('supervisorName')} {...field('supervisorName')} />
        <TextField label="Supervisor's Title" required autoComplete="off" placeholder="e.g. Charge RN, Nurse Manager, DON" returnKeyType="next" onSubmitEditing={() => focusNext('supervisorTitle')} {...field('supervisorTitle')} />
        <TextField label="Facility / Employer" required autoComplete="off" hint="Where you reported to this supervisor" returnKeyType="next" onSubmitEditing={() => focusNext('employerName')} {...field('employerName')} />
        <TextField label="Supervisor's Phone" required keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" returnKeyType="next" onSubmitEditing={() => focusNext('supervisorPhone')} {...field('supervisorPhone')} />
        <TextField label="Supervisor's Email" hint="Optional" keyboardType="email-address" autoCapitalize="none" autoComplete="off" returnKeyType="done" onSubmitEditing={() => {}} {...field('supervisorEmail')} />
      </FormSection>

      <View onLayout={(e) => setFieldOffset('permissionGranted', e)}>
        <CheckboxField
          label="I hereby give permission to the above-named employer to release information to Paramount Care Staffing, LLC regarding my performance while employed at that facility."
          value={form.data.permissionGranted}
          onChange={(v) => form.setField('permissionGranted', v)}
          error={form.errors.permissionGranted}
        />
      </View>

    </Screen>
  );
}
