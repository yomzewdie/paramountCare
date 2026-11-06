import { useCallback, useRef } from 'react';
import { ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import {
  EMPLOYMENT_TYPE_OPTIONS,
  LICENSE_TYPE_OPTIONS,
  MINIMUM_YEARS_OF_EXPERIENCE_BY_POSITION,
  POSITION_OPTIONS,
  SHIFT_PREFERENCE_OPTIONS,
  clinicalSpecialtyOptionsFor,
  parseYearsOfExperience,
  requiresUnitPreference,
  specialtyOptionsFor,
  type EmploymentApplicationData,
} from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SelectField } from '../../components/SelectField';
import { YesNoField } from '../../components/YesNoField';
import { MultiSelectField } from '../../components/MultiSelectField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useStepNavigation } from './stepNavigation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { US_STATE_OPTIONS } from '../../constants/usStates';
import { useEmploymentApplicationForm } from './useEmploymentApplicationForm';

// Visual field order — used only to decide where to scroll on a failed
// Complete attempt. Work history comes from the resume (see packets.ts) and is
// not asked here. Non-text fields (selects, yes/no toggles) are included
// for scroll targeting even though they never receive a focus-chain ref —
// same accepted pattern as every prior step screen.
const FIELD_ORDER: (keyof EmploymentApplicationData)[] = [
  'positionApplied', 'specialtyPreference', 'employmentType', 'shiftPreference', 'availableStartDate',
  'totalYearsExperience', 'primaryClinicalSpecialty',
  'licenseType', 'licenseNumber', 'licenseState', 'licenseExpiration',
  'authorizedToWork', 'hasConviction', 'convictionDetails',
  'hasLicenseDiscipline', 'licenseDisciplineDetails',
  'hasLicenseRevocation', 'licenseRevocationDetails', 'licenseRevocationJurisdiction', 'licenseRevocationDate',
  'underInvestigation',
  'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone',
];

export default function EmploymentApplicationScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
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

  const minimumYears = MINIMUM_YEARS_OF_EXPERIENCE_BY_POSITION[form.data.positionApplied];
  const isNewGraduate = parseYearsOfExperience(form.data.totalYearsExperience) === 0;

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Applicant Details</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        Tell us about the role you&rsquo;re seeking, your experience, your professional license, and your background. Your work history comes from your resume. All questions in the Eligibility &amp; Background section are required — a &ldquo;Yes&rdquo; answer does not automatically disqualify you.
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
        <View onLayout={(e) => setFieldOffset('positionApplied', e)}>
          <SelectField label="Position Applied For" required options={POSITION_OPTIONS} {...select('positionApplied')} />
        </View>
        {/* Not asked of a CNA (stored as the canonical CNA value). Options
            depend on the position; selections from another position stay as
            drafts but are never active, validated, or submitted. */}
        {form.data.positionApplied && requiresUnitPreference(form.data.positionApplied) ? (
          <View onLayout={(e) => setFieldOffset('specialtyPreference', e)}>
            <MultiSelectField
              label="Specialty / Unit Preference" required hint="Where you would like to work — select all that apply"
              options={specialtyOptionsFor(form.data.positionApplied)} values={form.data.specialtyPreference}
              onToggle={(v) => form.toggleSelection('specialtyPreference', v)}
              error={form.errors.specialtyPreference}
            />
          </View>
        ) : null}
        <View onLayout={(e) => setFieldOffset('employmentType', e)}>
          <MultiSelectField
            label="Employment Type" required hint="Select one or both"
            options={EMPLOYMENT_TYPE_OPTIONS} values={form.data.employmentType}
            onToggle={(v) => form.toggleSelection('employmentType', v)}
            error={form.errors.employmentType}
          />
        </View>
        <View onLayout={(e) => setFieldOffset('shiftPreference', e)}>
          <MultiSelectField
            label="Shift Preference" required hint="Select all that apply"
            options={SHIFT_PREFERENCE_OPTIONS} values={form.data.shiftPreference}
            onToggle={(v) => form.toggleSelection('shiftPreference', v)}
            error={form.errors.shiftPreference}
          />
        </View>
        <TextField
          label="Available Start Date" hint="Optional — MM/DD/YYYY" placeholder="MM/DD/YYYY" keyboardType="number-pad" maxLength={10}
          returnKeyType="next" onSubmitEditing={() => fieldRefs.current.licenseNumber?.focus()}
          {...field('availableStartDate')}
          value={form.slashDateDisplay('availableStartDate')}
          onChangeText={(t) => form.setSlashDateInput('availableStartDate', t)}
        />
      </FormSection>

      <FormSection title="Experience">
        <TextField
          label="Total Years of Professional Experience" required keyboardType="decimal-pad" placeholder="e.g. 1.5" returnKeyType="next"
          hint={minimumYears !== undefined ? `${form.data.positionApplied} applicants need at least ${minimumYears} ${minimumYears === 1 ? 'year' : 'years'}. Your employers and dates come from your resume.` : 'Your total, such as 1, 1.5, or 2.5. Your employers and dates come from your resume.'}
          onSubmitEditing={() => focusNext('totalYearsExperience')}
          {...field('totalYearsExperience')}
        />
        {/* Where the applicant HAS experience — distinct from the Specialty /
            Unit Preference above. Same CNA rule: not asked, stored canonically.
            Not required at 0 years: a new graduate has no specialty to name. */}
        {form.data.positionApplied && requiresUnitPreference(form.data.positionApplied) ? (
          <View onLayout={(e) => setFieldOffset('primaryClinicalSpecialty', e)}>
            <MultiSelectField
              label="Primary Clinical Specialty" required={!isNewGraduate}
              hint={isNewGraduate ? 'Optional with no professional experience yet' : 'Clinical areas where you have experience — select all that apply'}
              options={clinicalSpecialtyOptionsFor(form.data.positionApplied)} values={form.data.primaryClinicalSpecialty}
              onToggle={(v) => form.toggleSelection('primaryClinicalSpecialty', v)}
              error={form.errors.primaryClinicalSpecialty}
            />
          </View>
        ) : null}
      </FormSection>

      <FormSection title="Professional License">
        <View onLayout={(e) => setFieldOffset('licenseType', e)}>
          <SelectField label="License / Certification Type" required options={LICENSE_TYPE_OPTIONS} {...select('licenseType')} />
        </View>
        <TextField label="License Number" required placeholder="e.g. RN123456" returnKeyType="next" onSubmitEditing={() => focusNext('licenseNumber')} {...field('licenseNumber')} />
        <View onLayout={(e) => setFieldOffset('licenseState', e)}>
          <SelectField label="License State" required options={US_STATE_OPTIONS} {...select('licenseState')} />
        </View>
        <TextField
          label="License Expiration Date" required hint="MM-DD-YYYY" placeholder="MM-DD-YYYY"
          keyboardType="number-pad" maxLength={10} returnKeyType="next" onSubmitEditing={() => focusNext('licenseExpiration')}
          {...field('licenseExpiration')}
          value={form.licenseExpirationDisplay}
          onChangeText={form.setLicenseExpirationInput}
        />
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
            <TextField
              label="Approximate Date of Action" hint="Optional — MM/DD/YYYY" placeholder="MM/DD/YYYY" keyboardType="number-pad" maxLength={10}
              returnKeyType="next" onSubmitEditing={() => focusNext('licenseRevocationDate')}
              {...field('licenseRevocationDate')}
              value={form.slashDateDisplay('licenseRevocationDate')}
              onChangeText={(t) => form.setSlashDateInput('licenseRevocationDate', t)}
            />
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
