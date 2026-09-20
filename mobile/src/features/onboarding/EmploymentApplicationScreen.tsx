import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import type { EmploymentApplicationData } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SelectField, type SelectOption } from '../../components/SelectField';
import { YesNoField } from '../../components/YesNoField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { US_STATE_OPTIONS } from '../../constants/usStates';
import { useEmploymentApplicationForm } from './useEmploymentApplicationForm';

// Mirrors the existing web EmploymentApplicationSection.tsx's exact option
// lists — not a domain/business concern, so not in @pcs/shared.
const LICENSE_TYPE_OPTIONS: SelectOption[] = [
  { label: 'Registered Nurse (RN)', value: 'RN' },
  { label: 'Licensed Vocational Nurse (LVN)', value: 'LVN' },
  { label: 'Nurse Practitioner (NP)', value: 'NP' },
  { label: 'Certified Nursing Assistant (CNA)', value: 'CNA' },
  { label: 'Other', value: 'other' },
];
const EMPLOYMENT_TYPE_OPTIONS: SelectOption[] = [
  { label: 'Full-Time', value: 'full_time' },
  { label: 'Part-Time', value: 'part_time' },
  { label: 'Per Diem', value: 'per_diem' },
];
const SHIFT_PREFERENCE_OPTIONS: SelectOption[] = [
  { label: 'Day (7a–7p / 8a–4p)', value: 'day' },
  { label: 'Evening (3p–11p)', value: 'evening' },
  { label: 'Night (7p–7a / 11p–7a)', value: 'night' },
  { label: 'Open to any shift', value: 'any' },
];
const YEARS_EXPERIENCE_OPTIONS: SelectOption[] = [
  { label: 'Less than 1 year', value: '0-1' },
  { label: '1 – 3 years', value: '1-3' },
  { label: '3 – 5 years', value: '3-5' },
  { label: '5 – 10 years', value: '5-10' },
  { label: '10+ years', value: '10+' },
];

// Visual field order — used only to decide where to scroll on a failed
// Complete attempt. Non-text fields (selects, yes/no toggles) are included
// for scroll targeting even though they never receive a focus-chain ref —
// same accepted pattern as every prior step screen.
const FIELD_ORDER: (keyof EmploymentApplicationData)[] = [
  'licenseType', 'positionApplied', 'specialtyPreference', 'employmentType', 'shiftPreference', 'availableStartDate',
  'licenseNumber', 'licenseState', 'licenseExpiration', 'hasCPR', 'cprCertNumber', 'cprExpiration',
  'yearsExperience', 'primarySpecialty', 'currentlyEmployed', 'previouslyWorkedHere',
  'authorizedToWork', 'hasConviction', 'convictionDetails',
  'hasLicenseDiscipline', 'licenseDisciplineDetails',
  'hasLicenseRevocation', 'licenseRevocationDetails', 'licenseRevocationJurisdiction', 'licenseRevocationDate',
  'underInvestigation',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
];

export default function EmploymentApplicationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useEmploymentApplicationForm();

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<keyof EmploymentApplicationData, number>>>({});
  const fieldRefs = useRef<Partial<Record<keyof EmploymentApplicationData, TextInput | null>>>({});

  const setFieldRef = useCallback((field: keyof EmploymentApplicationData, r: TextInput | null) => {
    fieldRefs.current[field] = r;
  }, []);
  const setFieldOffset = useCallback((field: keyof EmploymentApplicationData, e: LayoutChangeEvent) => {
    fieldOffsets.current[field] = e.nativeEvent.layout.y;
  }, []);

  function focusNext(field: keyof EmploymentApplicationData) {
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

  const field = (key: keyof EmploymentApplicationData) => ({
    value: form.data[key] as string,
    onChangeText: (v: string) => form.setField(key, v as EmploymentApplicationData[typeof key]),
    onBlur: () => form.blurField(key),
    onLayout: (e: LayoutChangeEvent) => setFieldOffset(key, e),
    error: form.errors[key],
    ref: (r: TextInput | null) => setFieldRef(key, r),
  });

  const select = (key: keyof EmploymentApplicationData) => ({
    value: form.data[key] as string,
    onValueChange: (v: string) => form.setField(key, v as EmploymentApplicationData[typeof key]),
    error: form.errors[key],
  });

  const yesNo = (key: keyof EmploymentApplicationData) => ({
    value: form.data[key] as boolean | null,
    onChange: (v: boolean) => form.setField(key, v as EmploymentApplicationData[typeof key]),
    error: form.errors[key],
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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Employment Application</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Tell us about the role you&rsquo;re seeking, your professional license, and your background. All questions in the Eligibility &amp; Background section are required — a &ldquo;Yes&rdquo; answer does not automatically disqualify you.
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

      <FormSection title="Position Applied For">
        <View onLayout={(e) => setFieldOffset('licenseType', e)}>
          <SelectField label="License / Position Type" required options={LICENSE_TYPE_OPTIONS} {...select('licenseType')} />
        </View>
        <TextField label="Position Applied For" required placeholder="e.g. RN — Med/Surg, ICU Travel RN" returnKeyType="next" onSubmitEditing={() => focusNext('positionApplied')} {...field('positionApplied')} />
        <TextField label="Specialty / Unit Preference" required placeholder="e.g. ICU, ER, L&D, Pediatrics" returnKeyType="next" onSubmitEditing={() => focusNext('specialtyPreference')} {...field('specialtyPreference')} />
        <View onLayout={(e) => setFieldOffset('employmentType', e)}>
          <SelectField label="Employment Type" required options={EMPLOYMENT_TYPE_OPTIONS} {...select('employmentType')} />
        </View>
        <View onLayout={(e) => setFieldOffset('shiftPreference', e)}>
          <SelectField label="Shift Preference" required options={SHIFT_PREFERENCE_OPTIONS} {...select('shiftPreference')} />
        </View>
        <TextField label="Available Start Date" hint="Optional — YYYY-MM-DD" placeholder="YYYY-MM-DD" returnKeyType="next" onSubmitEditing={() => focusNext('availableStartDate')} {...field('availableStartDate')} />
      </FormSection>

      <FormSection title="Professional License & CPR">
        <TextField label="License Number" required placeholder="e.g. RN123456" returnKeyType="next" onSubmitEditing={() => focusNext('licenseNumber')} {...field('licenseNumber')} />
        <View onLayout={(e) => setFieldOffset('licenseState', e)}>
          <SelectField label="License State" required options={US_STATE_OPTIONS} {...select('licenseState')} />
        </View>
        <TextField label="License Expiration Date" required hint="YYYY-MM-DD" placeholder="YYYY-MM-DD" returnKeyType="next" onSubmitEditing={() => focusNext('licenseExpiration')} {...field('licenseExpiration')} />
        <View onLayout={(e) => setFieldOffset('hasCPR', e)}>
          <YesNoField label="Do you hold a current CPR/BLS certification?" {...yesNo('hasCPR')} />
        </View>
        {form.data.hasCPR ? (
          <>
            <TextField label="CPR Certification Number" hint="Optional" returnKeyType="next" onSubmitEditing={() => focusNext('cprCertNumber')} {...field('cprCertNumber')} />
            <TextField label="CPR Expiration Date" hint="Optional — YYYY-MM-DD" placeholder="YYYY-MM-DD" returnKeyType="next" onSubmitEditing={() => focusNext('cprExpiration')} {...field('cprExpiration')} />
          </>
        ) : null}
      </FormSection>

      <FormSection title="Clinical Experience">
        <View onLayout={(e) => setFieldOffset('yearsExperience', e)}>
          <SelectField label="Total Years of Nursing Experience" required options={YEARS_EXPERIENCE_OPTIONS} {...select('yearsExperience')} />
        </View>
        <TextField label="Primary Clinical Specialty" required hint="Your main area of nursing practice" placeholder="e.g. Critical Care, Emergency, Med-Surg" returnKeyType="next" onSubmitEditing={() => focusNext('primarySpecialty')} {...field('primarySpecialty')} />
        <View onLayout={(e) => setFieldOffset('currentlyEmployed', e)}>
          <YesNoField label="Are you currently employed?" {...yesNo('currentlyEmployed')} />
        </View>
        <View onLayout={(e) => setFieldOffset('previouslyWorkedHere', e)}>
          <YesNoField label="Have you previously worked with Paramount Care Staffing, LLC?" {...yesNo('previouslyWorkedHere')} />
        </View>
      </FormSection>

      <FormSection title="Eligibility & Background">
        <View onLayout={(e) => setFieldOffset('authorizedToWork', e)}>
          <YesNoField label="Are you legally authorized to work in the United States?" required {...yesNo('authorizedToWork')} />
        </View>
        {form.data.authorizedToWork === false ? (
          <Text style={[theme.typography.caption, { color: theme.colors.danger, marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md }]}>
            You must be legally authorized to work in the United States to be placed through Paramount Care Staffing, LLC.
          </Text>
        ) : null}

        <View onLayout={(e) => setFieldOffset('hasConviction', e)}>
          <YesNoField label="Have you ever been convicted of a felony (excluding sealed or expunged records)?" required {...yesNo('hasConviction')} />
        </View>
        {form.data.hasConviction ? (
          <TextField label="Please explain the nature of the conviction(s)" required multiline numberOfLines={3} placeholder="Provide the offense, jurisdiction, and date of conviction…" returnKeyType="next" onSubmitEditing={() => focusNext('convictionDetails')} {...field('convictionDetails')} />
        ) : null}

        <View onLayout={(e) => setFieldOffset('hasLicenseDiscipline', e)}>
          <YesNoField label="Have you ever had disciplinary action taken against your professional license?" required {...yesNo('hasLicenseDiscipline')} />
        </View>
        {form.data.hasLicenseDiscipline ? (
          <TextField label="Please describe the disciplinary action" required multiline numberOfLines={3} placeholder="Describe the action, licensing board, and current status of your license…" returnKeyType="next" onSubmitEditing={() => focusNext('licenseDisciplineDetails')} {...field('licenseDisciplineDetails')} />
        ) : null}

        <View onLayout={(e) => setFieldOffset('hasLicenseRevocation', e)}>
          <YesNoField label="Have you ever had your License or Certification limited, suspended, revoked, or voluntarily relinquished?" required {...yesNo('hasLicenseRevocation')} />
        </View>
        {form.data.hasLicenseRevocation ? (
          <>
            <TextField label="Please describe the circumstances" required multiline numberOfLines={3} placeholder="Describe what occurred, which license/certification was affected, the licensing board, and the outcome…" returnKeyType="next" onSubmitEditing={() => focusNext('licenseRevocationDetails')} {...field('licenseRevocationDetails')} />
            <View onLayout={(e) => setFieldOffset('licenseRevocationJurisdiction', e)}>
              <SelectField label="State / Jurisdiction" options={US_STATE_OPTIONS} placeholder="Select state (optional)" {...select('licenseRevocationJurisdiction')} />
            </View>
            <TextField label="Approximate Date of Action" hint="Optional — YYYY-MM-DD" placeholder="YYYY-MM-DD" returnKeyType="next" onSubmitEditing={() => focusNext('licenseRevocationDate')} {...field('licenseRevocationDate')} />
          </>
        ) : null}

        <View onLayout={(e) => setFieldOffset('underInvestigation', e)}>
          <YesNoField label="Are you currently under investigation by any professional licensing board?" required {...yesNo('underInvestigation')} />
        </View>

        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.sm }]}>
          Answering &ldquo;Yes&rdquo; to any background question does not automatically disqualify you from employment. All disclosures are reviewed on a case-by-case basis in accordance with applicable California and federal law, including the Fair Chance Act.
        </Text>
      </FormSection>

      <FormSection title="Emergency Contact">
        <TextField label="Full Name" required placeholder="Jane Smith" returnKeyType="next" onSubmitEditing={() => focusNext('emergencyContactName')} {...field('emergencyContactName')} />
        <TextField label="Relationship" required placeholder="Spouse, Parent, Sibling, Friend…" returnKeyType="next" onSubmitEditing={() => focusNext('emergencyContactRelationship')} {...field('emergencyContactRelationship')} />
        <TextField label="Phone Number" required keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" returnKeyType="done" onSubmitEditing={() => {}} {...field('emergencyContactPhone')} />
      </FormSection>

    </Screen>
  );
}
