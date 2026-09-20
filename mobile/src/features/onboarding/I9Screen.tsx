import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import type { AlienWorkAuthType, CitizenshipStatus, I9Data } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SensitiveField } from '../../components/SensitiveField';
import { SignaturePad } from '../../components/SignaturePad';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { US_STATE_OPTIONS } from '../../constants/usStates';
import { SelectField } from '../../components/SelectField';
import { useI9Form } from './useI9Form';

// Labels sourced from the existing PDF-generation code's own
// CITIZENSHIP_LABELS (worker/src/services/i9pdf.ts) — not reworded.
const CITIZENSHIP_OPTIONS: { value: CitizenshipStatus; label: string }[] = [
  { value: 'citizen', label: 'A citizen of the United States' },
  { value: 'noncitizen_national', label: 'A noncitizen national of the United States' },
  { value: 'lawful_permanent_resident', label: 'A lawful permanent resident' },
  { value: 'alien_authorized', label: 'A noncitizen authorized to work' },
];

const AUTH_TYPE_OPTIONS: { value: AlienWorkAuthType; label: string }[] = [
  { value: 'arn', label: 'USCIS / A-Number' },
  { value: 'i94', label: 'Form I-94 Admission Number' },
  { value: 'passport', label: 'Foreign Passport' },
];

const FIELD_ORDER: (keyof I9Data | 'i9Signature')[] = [
  'dateOfBirth', 'citizenshipStatus', 'alienRegistrationNumber', 'alienWorkAuthExpiration', 'alienWorkAuthType',
  'alienNumber', 'i94Number', 'foreignPassportNumber', 'i9Signature', 'i9SignedDate',
];

function ChoiceCard({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.choiceCard,
        {
          minHeight: theme.minTouchTarget,
          borderRadius: theme.radii.sm,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: theme.colors.surface,
          marginBottom: theme.spacing.sm,
        },
      ]}
    >
      <View style={[styles.radioOuter, { borderColor: selected ? theme.colors.primary : theme.colors.border }]}>
        {selected ? <View style={[styles.radioInner, { backgroundColor: theme.colors.primary }]} /> : null}
      </View>
      <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export default function I9Screen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useI9Form();
  const [sigMode, setSigMode] = useState<'draw' | 'type'>(() => (form.data.i9SignatureType === 'typed' ? 'type' : 'draw'));

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<keyof I9Data | 'i9Signature', number>>>({});
  const fieldRefs = useRef<Partial<Record<keyof I9Data, TextInput | null>>>({});

  const setFieldRef = useCallback((field: keyof I9Data, r: TextInput | null) => {
    fieldRefs.current[field] = r;
  }, []);
  const setFieldOffset = useCallback((field: keyof I9Data | 'i9Signature', e: LayoutChangeEvent) => {
    fieldOffsets.current[field] = e.nativeEvent.layout.y;
  }, []);

  function focusNext(field: keyof I9Data) {
    const idx = FIELD_ORDER.indexOf(field);
    const next = FIELD_ORDER[idx + 1];
    if (next && next !== 'i9Signature') fieldRefs.current[next as keyof I9Data]?.focus();
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

  function switchSignatureMode(mode: 'draw' | 'type') {
    setSigMode(mode);
    form.resetSignatureForModeSwitch();
  }

  const field = (key: keyof I9Data) => ({
    value: form.data[key] as string,
    onChangeText: (v: string) => form.setField(key, v as I9Data[typeof key]),
    onBlur: () => form.blurField(key),
    onLayout: (e: LayoutChangeEvent) => setFieldOffset(key, e),
    error: form.errors[key],
    ref: (r: TextInput | null) => setFieldRef(key, r),
  });

  const hasSignature = sigMode === 'draw' ? !!form.data.i9SignatureDataUrl : !!form.data.i9TypedSignature.trim();

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Form I-9 (Section 1)</Text>

      <View style={[styles.notice, { backgroundColor: theme.colors.warningSurface, borderColor: theme.colors.warning, marginBottom: theme.spacing.lg }]}>
        <Text style={[theme.typography.caption, { color: theme.colors.warning }]}>
          Official Form I-9 — Section 1 (Employee). Federal law requires employees to complete and sign Section 1 no later than the first day of employment. Providing false information is a federal crime.
        </Text>
      </View>

      {form.conflict ? (
        <View style={{ marginBottom: theme.spacing.lg }}>
          <ErrorState message="Newer onboarding data was found for your account. Your changes on this screen have not been lost — choose how to continue." />
          <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
            <Button label="Keep my changes and retry" onPress={form.keepMyChanges} />
            <Button label="Discard my changes and show the latest" variant="secondary" onPress={form.discardAndReloadLatest} />
          </View>
        </View>
      ) : null}

      <FormSection title="Employee Information">
        <TextField label="Last Name (Family Name)" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.firstName?.focus()} {...field('lastName')} />
        <TextField label="First Name (Given Name)" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.middleInitial?.focus()} {...field('firstName')} />
        <TextField label="Middle Initial" maxLength={1} autoCapitalize="characters" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.otherLastNames?.focus()} {...field('middleInitial')} />
        <TextField label="Other Last Names Used" hint="Enter N/A if none" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.address?.focus()} {...field('otherLastNames')} />
        <TextField label="Address (Number and Street)" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.aptNumber?.focus()} {...field('address')} />
        <TextField label="Apt. Number" hint="Optional" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.city?.focus()} {...field('aptNumber')} />
        <TextField label="City or Town" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.state?.focus()} {...field('city')} />
        <SelectField label="State" options={US_STATE_OPTIONS} value={form.data.state} onValueChange={(v) => form.setField('state', v)} />
        <TextField label="ZIP Code" keyboardType="number-pad" maxLength={10} returnKeyType="next" onSubmitEditing={() => fieldRefs.current.email?.focus()} {...field('zip')} />
        <TextField label="Email Address" keyboardType="email-address" autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => fieldRefs.current.phone?.focus()} {...field('email')} />
        <TextField label="Telephone Number" keyboardType="phone-pad" returnKeyType="done" onSubmitEditing={() => {}} {...field('phone')} />
      </FormSection>

      <FormSection title="Identity Verification">
        <TextField label="Date of Birth" required hint="MM/DD/YYYY" placeholder="MM/DD/YYYY" returnKeyType="next" onSubmitEditing={() => focusNext('dateOfBirth')} {...field('dateOfBirth')} />
        <View onLayout={(e) => setFieldOffset('ssn', e)}>
          <SensitiveField
            label="Social Security Number"
            value={form.data.ssn}
            onChangeText={(v) => form.setField('ssn', v)}
            hint="Optional — required only if your employer uses E-Verify."
          />
        </View>
      </FormSection>

      <FormSection title="Citizenship / Immigration Status">
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
          I attest, under penalty of perjury, that I am (select one) and that the information I have provided is true and correct.
        </Text>
        <View onLayout={(e) => setFieldOffset('citizenshipStatus', e)}>
          {CITIZENSHIP_OPTIONS.map((opt) => (
            <ChoiceCard key={opt.value} label={opt.label} selected={form.data.citizenshipStatus === opt.value} onSelect={() => form.setCitizenshipStatus(opt.value)} />
          ))}
          {form.errors.citizenshipStatus ? (
            <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>{form.errors.citizenshipStatus}</Text>
          ) : null}
        </View>

        {form.data.citizenshipStatus === 'lawful_permanent_resident' ? (
          <View onLayout={(e) => setFieldOffset('alienRegistrationNumber', e)}>
            <TextField label="Alien Registration Number / USCIS Number" required returnKeyType="done" onSubmitEditing={() => {}} {...field('alienRegistrationNumber')} />
          </View>
        ) : null}

        {form.data.citizenshipStatus === 'alien_authorized' ? (
          <>
            <View onLayout={(e) => setFieldOffset('alienWorkAuthExpiration', e)}>
              <TextField label="Work Authorization Expiration Date" required hint="MM/DD/YYYY, or enter N/A if not applicable" placeholder="MM/DD/YYYY or N/A" returnKeyType="done" onSubmitEditing={() => {}} {...field('alienWorkAuthExpiration')} />
            </View>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
              How will you verify your work authorization? <Text style={{ color: theme.colors.danger }}>*</Text>
            </Text>
            <View onLayout={(e) => setFieldOffset('alienWorkAuthType', e)} style={{ marginBottom: theme.spacing.sm }}>
              {AUTH_TYPE_OPTIONS.map((opt) => (
                <ChoiceCard key={opt.value} label={opt.label} selected={form.data.alienWorkAuthType === opt.value} onSelect={() => form.setAlienWorkAuthType(opt.value)} />
              ))}
              {form.errors.alienWorkAuthType ? (
                <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger }]}>{form.errors.alienWorkAuthType}</Text>
              ) : null}
            </View>
            {form.data.alienWorkAuthType === 'arn' ? (
              <View onLayout={(e) => setFieldOffset('alienNumber', e)}>
                <TextField label="USCIS / A-Number" required returnKeyType="done" onSubmitEditing={() => {}} {...field('alienNumber')} />
              </View>
            ) : null}
            {form.data.alienWorkAuthType === 'i94' ? (
              <View onLayout={(e) => setFieldOffset('i94Number', e)}>
                <TextField label="Form I-94 Admission Number" required returnKeyType="done" onSubmitEditing={() => {}} {...field('i94Number')} />
              </View>
            ) : null}
            {form.data.alienWorkAuthType === 'passport' ? (
              <View onLayout={(e) => setFieldOffset('foreignPassportNumber', e)}>
                <TextField label="Foreign Passport Number" required returnKeyType="next" onSubmitEditing={() => fieldRefs.current.foreignPassportCountry?.focus()} {...field('foreignPassportNumber')} />
                <TextField label="Country of Issuance" required returnKeyType="done" onSubmitEditing={() => {}} {...field('foreignPassportCountry')} />
              </View>
            ) : null}
          </>
        ) : null}
      </FormSection>

      <View style={[styles.notice, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginBottom: theme.spacing.lg }]}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          Section 2 — Employer Use Only. Completed by Paramount Care Staffing, LLC after your first day of employment. No action is required from you here.
        </Text>
      </View>

      <FormSection title="Employee Signature">
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
          <Button label="Draw" variant={sigMode === 'draw' ? 'primary' : 'secondary'} onPress={() => switchSignatureMode('draw')} />
          <Button label="Type" variant={sigMode === 'type' ? 'primary' : 'secondary'} onPress={() => switchSignatureMode('type')} />
        </View>

        <View onLayout={(e) => setFieldOffset('i9Signature', e)}>
          {sigMode === 'draw' ? (
            <SignaturePad
              value={form.data.i9SignatureDataUrl}
              onChange={form.setDrawnSignature}
              onClear={form.clearDrawnSignature}
              error={form.errors.i9Signature}
            />
          ) : (
            <TextField
              label="Type your full legal name to sign"
              required
              placeholder="Full legal name"
              value={form.data.i9TypedSignature}
              onChangeText={form.setTypedSignature}
              onBlur={() => form.blurField('i9Signature')}
              error={form.errors.i9Signature}
              autoCapitalize="words"
              returnKeyType="done"
            />
          )}
        </View>

        {hasSignature && form.data.i9SignedDate ? (
          <View onLayout={(e) => setFieldOffset('i9SignedDate', e)}>
            <TextField label="Date" editable={false} value={form.data.i9SignedDate} onChangeText={() => {}} />
          </View>
        ) : null}
      </FormSection>

    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { borderWidth: 1, borderRadius: 12, padding: 12 },
  choiceCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
});
