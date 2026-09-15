import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import type { W4Data, W4FilingStatus } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SensitiveField } from '../../components/SensitiveField';
import { CheckboxField } from '../../components/CheckboxField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useW4Form } from './useW4Form';

const FILING_OPTIONS: { value: W4FilingStatus; label: string; desc: string }[] = [
  { value: 'single_mfs', label: 'Single or Married filing separately', desc: 'You are single, or married filing separately from your spouse.' },
  { value: 'mfj_qss', label: 'Married filing jointly or Qualifying surviving spouse', desc: 'You are married and filing jointly, or are a qualifying surviving spouse.' },
  { value: 'hoh', label: 'Head of household', desc: 'You file as head of household and pay more than half the costs of keeping up a qualifying home.' },
];

// Visual field order — used only to decide where to scroll on a failed
// Complete attempt. Non-text fields (filingStatus, a radio group) are
// included for scroll targeting even though they never receive a
// focus-chain ref — same accepted pattern as every prior step screen.
const FIELD_ORDER: (keyof W4Data)[] = [
  'firstNameMI', 'lastName', 'ssn', 'address', 'cityStateZip', 'filingStatus', 'typedSignature', 'signedDate',
];

function FilingOption({ label, desc, selected, onSelect }: { label: string; desc: string; selected: boolean; onSelect: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}. ${desc}`}
      style={[
        styles.filingOption,
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
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{label}</Text>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: 2 }]}>{desc}</Text>
      </View>
    </Pressable>
  );
}

function DollarField({ label, value, onChangeText, hint }: { label: string; value: string; onChangeText: (v: string) => void; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, position: 'absolute', left: 12, zIndex: 1 }]}>$</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={label}
          style={[
            styles.dollarInput,
            {
              minHeight: theme.minTouchTarget,
              borderRadius: theme.radii.sm,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
              color: theme.colors.text,
            },
          ]}
        />
      </View>
      {hint ? <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>{hint}</Text> : null}
    </View>
  );
}

export default function W4Screen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useW4Form();

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<keyof W4Data, number>>>({});
  const fieldRefs = useRef<Partial<Record<keyof W4Data, TextInput | null>>>({});

  const setFieldRef = useCallback((field: keyof W4Data, r: TextInput | null) => {
    fieldRefs.current[field] = r;
  }, []);
  const setFieldOffset = useCallback((field: keyof W4Data, e: LayoutChangeEvent) => {
    fieldOffsets.current[field] = e.nativeEvent.layout.y;
  }, []);

  function focusNext(field: keyof W4Data) {
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

  const field = (key: keyof W4Data) => ({
    value: form.data[key] as string,
    onChangeText: (v: string) => form.setField(key, v as W4Data[typeof key]),
    onBlur: () => form.blurField(key),
    onLayout: (e: LayoutChangeEvent) => setFieldOffset(key, e),
    error: form.errors[key],
    ref: (r: TextInput | null) => setFieldRef(key, r),
  });

  return (
    <Screen ref={scrollRef}>
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Tax Forms / W-4</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
        Employee&rsquo;s Withholding Certificate — complete this form so that your employer can withhold the correct federal income tax from your pay. Your withholding is subject to review by the IRS.
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

      <FormSection title="Step 1 — Personal Information">
        <TextField label="First name and middle initial" required placeholder="Jane M" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => focusNext('firstNameMI')} {...field('firstNameMI')} />
        <TextField label="Last name" required placeholder="Smith" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => focusNext('lastName')} {...field('lastName')} />
        <View onLayout={(e) => setFieldOffset('ssn', e)}>
          <SensitiveField
            label="Social security number"
            required
            value={form.data.ssn}
            onChangeText={(v) => form.setField('ssn', v)}
            error={form.errors.ssn}
            hint="Required for federal tax withholding. Never logged or stored on this device."
          />
        </View>
        <TextField label="Home address (number and street or rural route)" required placeholder="123 Main St" returnKeyType="next" onSubmitEditing={() => focusNext('address')} {...field('address')} />
        <TextField label="City or town, state, and ZIP code" required placeholder="Los Angeles, CA 90001" returnKeyType="done" onSubmitEditing={() => {}} {...field('cityStateZip')} />

        <View onLayout={(e) => setFieldOffset('filingStatus', e)} style={{ marginTop: theme.spacing.sm }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
            Filing status <Text style={{ color: theme.colors.danger }}>*</Text>
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
            Check only one box. Use the Head of household option only if you are unmarried and pay more than half the costs of keeping up a home for yourself and a qualifying individual.
          </Text>
          {FILING_OPTIONS.map((opt) => (
            <FilingOption key={opt.value} label={opt.label} desc={opt.desc} selected={form.data.filingStatus === opt.value} onSelect={() => form.setField('filingStatus', opt.value)} />
          ))}
          {form.errors.filingStatus ? (
            <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>{form.errors.filingStatus}</Text>
          ) : null}
        </View>
      </FormSection>

      <FormSection title="Step 2 — Multiple Jobs or Spouse Works (Optional)">
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
          Complete this step only if you hold more than one job at a time or are married filing jointly and your spouse also works.
        </Text>
        <CheckboxField
          label="Step 2(c): Multiple jobs or spouse works — if there are only two jobs total, check this box. Do the same on Form W-4 for the other job."
          value={form.data.multipleJobs}
          onChange={(v) => form.setField('multipleJobs', v)}
        />
      </FormSection>

      <FormSection title="Step 3 — Claim Dependents (Optional)">
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
          If your total income will be $200,000 or less ($400,000 or less if married filing jointly) complete the fields below.
        </Text>
        <DollarField
          label="Qualifying children under age 17 — multiply the number of qualifying children by $2,000"
          value={form.data.qualifyingChildren}
          onChangeText={form.setQualifyingChildren}
          hint="Example: 2 qualifying children × $2,000 = enter 4000"
        />
        <DollarField
          label="Other dependents — multiply the number of other dependents by $500"
          value={form.data.otherDependents}
          onChangeText={form.setOtherDependents}
          hint="Example: 1 other dependent × $500 = enter 500"
        />
        <DollarField
          label="Add the amounts above — enter total here"
          value={form.displayedTotalDependents}
          onChangeText={(v) => form.setField('totalDependents', v)}
          hint="This amount reduces your withholding."
        />
      </FormSection>

      <FormSection title="Step 4 — Other Adjustments (Optional)">
        <DollarField label="(a) Other income — not from jobs" value={form.data.otherIncome} onChangeText={(v) => form.setField('otherIncome', v)} hint="Interest, dividends, retirement income, etc." />
        <DollarField label="(b) Deductions — if claiming deductions other than the standard deduction" value={form.data.deductions} onChangeText={(v) => form.setField('deductions', v)} />
        <DollarField label="(c) Extra withholding — additional tax you want withheld each pay period" value={form.data.extraWithholding} onChangeText={(v) => form.setField('extraWithholding', v)} />
      </FormSection>

      <FormSection title="Step 5 — Sign Here">
        <View style={[styles.notice, { backgroundColor: theme.colors.warningSurface, borderColor: theme.colors.warning, marginBottom: theme.spacing.md }]}>
          <Text style={[theme.typography.caption, { color: theme.colors.warning }]}>
            Declaration under penalty of perjury. Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.
          </Text>
        </View>
        <View onLayout={(e) => setFieldOffset('typedSignature', e)}>
          <TextField
            ref={(r) => setFieldRef('typedSignature', r)}
            label="Employee's signature"
            required
            placeholder="Type your full legal name"
            value={form.data.typedSignature}
            onChangeText={form.setTypedSignature}
            onBlur={() => form.blurField('typedSignature')}
            error={form.errors.typedSignature}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }]}>
          By typing your name above you are signing this form electronically. Your typed signature carries the same legal weight as a handwritten signature.
        </Text>
        <View onLayout={(e) => setFieldOffset('signedDate', e)}>
          <TextField label="Date" required editable={false} value={form.data.signedDate} placeholder="Auto-set when you sign" error={form.errors.signedDate} onChangeText={() => {}} />
        </View>
      </FormSection>

      <View style={[styles.notice, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, marginBottom: theme.spacing.lg }]}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          Employer sections (Employer&rsquo;s name and address, EIN, First date of employment) are completed by Paramount Care Staffing, LLC and do not require your input.
        </Text>
      </View>

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

const styles = StyleSheet.create({
  filingOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, padding: 12 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  dollarInput: { flex: 1, borderWidth: 1, paddingLeft: 24, paddingRight: 12, fontSize: 16 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12 },
});
