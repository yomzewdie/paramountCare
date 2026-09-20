import { useCallback, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { getPacket, type EmploymentReference } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SelectField } from '../../components/SelectField';
import { YesNoField } from '../../components/YesNoField';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { US_STATE_OPTIONS } from '../../constants/usStates';
import { useSession } from './SessionContext';
import { useEmploymentReferenceForm } from './useEmploymentReferenceForm';

// Visual field order — used only to decide where to scroll on a failed
// Complete attempt (same purpose as PersonalInfoScreen's FIELD_ORDER).
// Non-text fields (employerState, eligibleForRehire, permissionGranted)
// are included for scroll targeting even though they never receive a
// focus-chain ref — same accepted pattern as 'state' in PersonalInfoScreen.
const FIELD_ORDER: (keyof EmploymentReference)[] = [
  'positionHeld', 'employmentDateFrom', 'employmentDateTo',
  'employerName', 'employerCity', 'employerState',
  'supervisorName', 'supervisorPhone',
  'reasonForLeaving', 'eligibleForRehire', 'rehireDetails', 'comments',
  'permissionGranted',
];

export default function EmploymentReferenceScreen() {
  const theme = useTheme();
  const router = useRouter();
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

  const field = (key: keyof EmploymentReference) => ({
    value: form.data[key] as string,
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
        Provide contact details for a clinical supervisor who can verify your employment history. Your reference must be someone you reported to directly, such as a Charge RN, RN Supervisor, DON, or Nurse Manager.
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

      <FormSection title="Employment Details">
        <TextField label="Position Held" required autoComplete="off" returnKeyType="next" onSubmitEditing={() => focusNext('positionHeld')} {...field('positionHeld')} />
        <TextField label="Employment From" required hint="MM/YYYY" placeholder="MM/YYYY" returnKeyType="next" onSubmitEditing={() => focusNext('employmentDateFrom')} {...field('employmentDateFrom')} />
        <TextField label="Employment To" required hint="MM/YYYY, or “Present”" placeholder="MM/YYYY or Present" returnKeyType="next" onSubmitEditing={() => focusNext('employmentDateTo')} {...field('employmentDateTo')} />
        <TextField label="Current / Former Employer" required autoComplete="off" returnKeyType="next" onSubmitEditing={() => focusNext('employerName')} {...field('employerName')} />
        <TextField label="City" required autoComplete="off" returnKeyType="next" onSubmitEditing={() => focusNext('employerCity')} {...field('employerCity')} />
        <View onLayout={(e) => setFieldOffset('employerState', e)}>
          <SelectField label="State" required options={US_STATE_OPTIONS} value={form.data.employerState} onValueChange={(v) => form.setField('employerState', v)} error={form.errors.employerState} />
        </View>
        <TextField label="Supervisor's Name" required autoComplete="off" returnKeyType="next" onSubmitEditing={() => focusNext('supervisorName')} {...field('supervisorName')} />
        <TextField label="Supervisor's Phone" required keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" returnKeyType="next" onSubmitEditing={() => focusNext('supervisorPhone')} {...field('supervisorPhone')} />
      </FormSection>

      <FormSection title="Leaving & Rehire Eligibility">
        <TextField label="Reason for Leaving" required multiline numberOfLines={3} returnKeyType="next" onSubmitEditing={() => focusNext('reasonForLeaving')} {...field('reasonForLeaving')} />
        <View onLayout={(e) => setFieldOffset('eligibleForRehire', e)}>
          <YesNoField
            label="Were you eligible for rehire at this employer?"
            required
            value={form.data.eligibleForRehire}
            onChange={(v) => form.setField('eligibleForRehire', v)}
            error={form.errors.eligibleForRehire}
          />
        </View>
        {form.data.eligibleForRehire === false ? (
          <TextField label="Please explain" required multiline numberOfLines={3} returnKeyType="next" onSubmitEditing={() => focusNext('rehireDetails')} {...field('rehireDetails')} />
        ) : null}
        <TextField label="Additional Comments" hint="Optional" multiline numberOfLines={3} returnKeyType="done" onSubmitEditing={() => {}} {...field('comments')} />
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
