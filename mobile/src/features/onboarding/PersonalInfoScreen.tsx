import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import type { PersonalInfo } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SelectField } from '../../components/SelectField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { US_STATE_OPTIONS } from '../../constants/usStates';
import { usePersonalInfoForm } from './usePersonalInfoForm';

// Visual field order — used only to decide which invalid field to scroll to
// on a failed Complete attempt. Deliberately separate from whatever key
// order @pcs/shared's zod schema happens to produce its issues in.
const FIELD_ORDER: (keyof PersonalInfo)[] = [
  'lastName', 'firstName', 'middleInitial', 'otherLastNames',
  'email', 'phone',
  'address', 'aptNumber', 'city', 'state', 'zip',
];

export default function PersonalInfoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = usePersonalInfoForm();

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<keyof PersonalInfo, number>>>({});
  const fieldRefs = useRef<Partial<Record<keyof PersonalInfo, TextInput | null>>>({});

  // Stable (useCallback, empty deps) functions that happen to write to a
  // ref, rather than a fresh closure built inline during every render — the
  // react-hooks refs rule flags ref-mutating functions that are recreated
  // per render; these aren't, even though the field key is passed as a
  // parameter each call instead of being baked into a per-field closure.
  const setFieldRef = useCallback((field: keyof PersonalInfo, r: TextInput | null) => {
    fieldRefs.current[field] = r;
  }, []);
  const setFieldOffset = useCallback((field: keyof PersonalInfo, e: LayoutChangeEvent) => {
    fieldOffsets.current[field] = e.nativeEvent.layout.y;
  }, []);

  function focusNext(field: keyof PersonalInfo) {
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
      router.back(); // returns to the onboarding step list / dashboard — no next-form to advance into yet (M5 §11)
    } else if (outcome.kind === 'invalid') {
      scrollToFirstError();
    }
  }

  const field = (key: keyof PersonalInfo) => ({
    value: form.data[key],
    onChangeText: (v: string) => form.setField(key, v),
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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Personal Information</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Enter your full legal name and contact details. Sensitive identity information (date of birth, SSN) is collected later, in the Form I-9 step.
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

      <FormSection title="Legal Name">
        <TextField label="Last Name" required autoComplete="family-name" textContentType="familyName" returnKeyType="next" onSubmitEditing={() => focusNext('lastName')} {...field('lastName')} />
        <TextField label="First Name" required autoComplete="given-name" textContentType="givenName" returnKeyType="next" onSubmitEditing={() => focusNext('firstName')} {...field('firstName')} />
        <TextField label="M.I." hint="Optional" maxLength={1} autoCapitalize="characters" returnKeyType="next" onSubmitEditing={() => focusNext('middleInitial')} {...field('middleInitial')} />
        <TextField label="Other Last Names Used" hint="Maiden name, alias, or leave blank" returnKeyType="next" onSubmitEditing={() => focusNext('otherLastNames')} {...field('otherLastNames')} />
      </FormSection>

      <FormSection title="Contact Information">
        <TextField label="Email Address" required keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => focusNext('email')} {...field('email')} />
        <TextField label="Phone Number" required keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" returnKeyType="next" onSubmitEditing={() => focusNext('phone')} {...field('phone')} />
      </FormSection>

      <FormSection title="Home Address">
        <TextField label="Street Address" required autoComplete="street-address" textContentType="streetAddressLine1" returnKeyType="next" onSubmitEditing={() => focusNext('address')} {...field('address')} />
        <TextField label="Apt. / Unit Number" hint="Optional" returnKeyType="next" onSubmitEditing={() => focusNext('aptNumber')} {...field('aptNumber')} />
        <TextField label="City or Town" required autoComplete="address-line2" textContentType="addressCity" returnKeyType="next" onSubmitEditing={() => focusNext('city')} {...field('city')} />
        <SelectField label="State" required options={US_STATE_OPTIONS} value={form.data.state} onValueChange={(v) => form.setField('state', v)} error={form.errors.state} />
        <TextField label="ZIP Code" required keyboardType="number-pad" maxLength={10} autoComplete="postal-code" textContentType="postalCode" returnKeyType="done" onSubmitEditing={() => {}} {...field('zip')} />
      </FormSection>

    </Screen>
  );
}
