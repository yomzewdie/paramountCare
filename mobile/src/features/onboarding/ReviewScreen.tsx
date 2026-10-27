import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { ProgressBar } from '../../components/ProgressBar';
import { ErrorState, SuccessState, LoadingState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useSession } from './SessionContext';
import { useReviewSubmission } from './useReviewSubmission';
import {
  EMPLOYMENT_TYPE_OPTIONS, LEGACY_EMPLOYMENT_TYPE_LABELS, LEGACY_LICENSE_TYPE_LABELS, LEGACY_SHIFT_PREFERENCE_LABELS,
  LICENSE_TYPE_OPTIONS, POSITION_OPTIONS, SHIFT_PREFERENCE_OPTIONS, SPECIALTY_OPTIONS,
  finalizeEmploymentApplication, formatOptionValues, isoDateToDisplay, isoDateToSlash,
} from '@pcs/shared';
import type {
  PersonalInfo, EmploymentReference, AcknowledgementEntry,
  W4Data, I9Data, SafetyEducationData, UploadedDocuments, UploadedFile,
} from '@pcs/shared';

// M16 (ADR-029). Section CONTENT (which fields are summarized in detail vs.
// shown as status-only) deliberately mirrors the real, existing product
// (frontend/components/onboarding/ReviewSection.tsx) rather than inventing
// a new selection: that source shows detailed field summaries for Personal
// Info, Employment Application, Employment References #1/#2, I-9, W-4,
// Vaccine Declarations, and Documents — but never Application Statement,
// Background Authorization, Health Info Auth, Patient Bill of Rights,
// JCAHO Review, or Direct Deposit's own bank details (that source never
// renders bank account/routing numbers anywhere, and never shows SSN
// either — confirmed by reading the whole file, not assumed). Those
// step + Direct Deposit are shown here as status-only rows (no invented
// masking convention — since source's own convention for sensitive
// content is simply "don't render it," not "render a masked version",
// following that exact convention is the correct read of "prefer masked
// summaries where existing product behavior supports it" instruction —
// there is no existing masked-value convention to reuse, so none is
// invented here either).

const VACCINE_STEPS = [
  { stepId: 'hep_b_declination', name: 'Hepatitis B (HBV)' },
  { stepId: 'tdap_declination', name: 'Tdap' },
  { stepId: 'flu_declination', name: 'Influenza / H1N1' },
];

const FILING_STATUS_LABELS: Record<string, string> = {
  single_mfs: 'Single or Married filing separately',
  mfj_qss: 'Married filing jointly or Qualifying surviving spouse',
  hoh: 'Head of household',
};
const CITIZENSHIP_LABELS: Record<string, string> = {
  citizen: 'U.S. Citizen',
  noncitizen_national: 'Noncitizen National of the U.S.',
  lawful_permanent_resident: 'Lawful Permanent Resident',
  alien_authorized: 'Noncitizen Authorized to Work',
};

function StatusBadge({ completed, required }: { completed: boolean; required: boolean }) {
  const theme = useTheme();
  if (!required) {
    return (
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontWeight: '700' }]}>Optional</Text>
    );
  }
  return (
    <Text
      accessibilityLabel={completed ? 'Complete' : 'Needs attention'}
      style={[theme.typography.caption, { color: completed ? theme.colors.success : theme.colors.warning, fontWeight: '700' }]}
    >
      {completed ? 'Complete' : 'Needs attention'}
    </Text>
  );
}

function SectionCard({
  title, completed, required, stepId, onEdit, children,
}: {
  title: string;
  completed: boolean;
  required: boolean;
  stepId?: string;
  onEdit?: (stepId: string) => void;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={{ marginBottom: theme.spacing.md, borderColor: required && !completed ? theme.colors.warning : theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, flex: 1 }]}>{title}</Text>
        <StatusBadge completed={completed} required={required} />
      </View>
      {children}
      {stepId && onEdit ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={`Edit ${title}`} variant="secondary" onPress={() => onEdit(stepId)} />
        </View>
      ) : null}
    </Card>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.xs }}>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text style={[theme.typography.body, { color: value ? theme.colors.text : theme.colors.textMuted }]}>
        {value || 'Not provided'}
      </Text>
    </View>
  );
}

function CheckRow({ label, checked }: { label: string; checked: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.xs, gap: theme.spacing.xs }}>
      <View
        style={{
          width: 16, height: 16, borderRadius: 8,
          backgroundColor: checked ? theme.colors.success : theme.colors.surfaceAlt,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {checked ? <Text style={{ color: theme.colors.surface, fontSize: 10, fontWeight: '700' }}>{'✓'}</Text> : null}
      </View>
      <Text style={[theme.typography.caption, { color: checked ? theme.colors.text : theme.colors.textMuted, flex: 1 }]}>{label}</Text>
    </View>
  );
}

export default function ReviewScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const { session, progress, status } = useSession();
  const review = useReviewSubmission();

  if (status === 'loading' || !session || !progress) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Loading your application…" />
      </Screen>
    );
  }

  const formData = session.formData;
  const personalInfo = (formData.personalInfo ?? {}) as Partial<PersonalInfo>;
  // The applicant's final answers — e.g. no hidden unit selections for a CNA
  // — exactly as the Worker will record them on submission.
  const employmentApplication = finalizeEmploymentApplication(formData.employmentApplication);
  const employmentReferences = (formData.employmentReferences ?? {}) as Record<string, Partial<EmploymentReference> | undefined>;
  const acknowledgements = (formData.acknowledgements ?? {}) as Record<string, Partial<AcknowledgementEntry> | undefined>;
  const w4Data = (formData.w4Data ?? {}) as Partial<W4Data>;
  const i9Data = (formData.i9Data ?? {}) as Partial<I9Data>;
  const safetyEducation = (formData.safetyEducation ?? {}) as Partial<SafetyEducationData>;
  const uploadedDocuments = (formData.uploadedDocuments ?? {}) as Partial<UploadedDocuments>;
  const resumeDocument = (formData.resumeDocument ?? null) as UploadedFile | null;

  // A step stored as 'completed' under older rules shows "Needs attention"
  // here, matching what Submit will accept (see steps.ts effectiveStepStates).
  function stepInfo(stepId: string) {
    const step = review.steps.find((s) => s.id === stepId);
    return { completed: step?.completed ?? false, required: step?.required ?? true, exists: !!step };
  }

  function onEdit(stepId: string) {
    router.push({ pathname: '/(app)/onboarding/[stepId]', params: { stepId, origin: 'review' } });
  }

  const jcahoInfo = stepInfo('jcaho_review');
  const safetyInfo = stepInfo('safety_acknowledgements');
  const directDepositInfo = stepInfo('direct_deposit');
  const appStatementInfo = stepInfo('application_statement');
  const backgroundAuthInfo = stepInfo('background_auth');
  const healthInfoAuthInfo = stepInfo('health_info_auth');
  const pborInfo = stepInfo('patient_bill_of_rights');

  async function handleSubmit() {
    await review.submit();
  }

  if (review.isSubmitted && session.applicationId) {
    return (
      <Screen scroll={false}>
        <SuccessState
          message={`Application submitted. Your reference number is ${session.applicationId}. Documents received — Paramount Care Staffing, LLC will review your application within 1–2 business days.`}
        />
        <View style={{ marginTop: theme.spacing.lg }}>
          <Button label="Back to Dashboard" onPress={() => router.replace('/(app)/home')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          {review.conflict ? (
            <View style={{ marginBottom: theme.spacing.md }}>
              <ErrorState message="This session was updated elsewhere since you last reviewed it. Your Review has been refreshed with the latest information — please check it and submit again." />
            </View>
          ) : null}

          {review.submitError ? (
            <View style={{ marginBottom: theme.spacing.md }}>
              <ErrorState message={review.submitError} />
            </View>
          ) : null}

          {review.incompleteSteps && review.incompleteSteps.length > 0 ? (
            <View style={{ marginBottom: theme.spacing.md }}>
              <ErrorState message={`Please complete: ${review.incompleteSteps.map((s) => s.label).join(', ')}`} />
            </View>
          ) : null}

          {!isConnected ? (
            <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.warning, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
              You&rsquo;re offline — connect to the internet to submit.
            </Text>
          ) : null}

          <Button
            label="Submit Application"
            onPress={handleSubmit}
            loading={review.isSubmitting}
            disabled={!isConnected || !review.readyToSubmit}
          />
        </>
      }
    >
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Review Your Application</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.md }]}>
        Review all information carefully. Tap Edit on any section to make changes.
      </Text>

      <View style={{ marginBottom: theme.spacing.md }}>
        <ProgressBar percent={session.completionPercent ?? 0} />
      </View>

      {review.readyToSubmit ? (
        <View style={{ marginBottom: theme.spacing.md, padding: theme.spacing.md, backgroundColor: theme.colors.successSurface, borderRadius: theme.radii.md }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.success }]}>Ready to submit</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>
            Every required section is complete.
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: theme.spacing.md, padding: theme.spacing.md, backgroundColor: theme.colors.warningSurface, borderRadius: theme.radii.md }}>
          <Text accessibilityLiveRegion="polite" style={[theme.typography.bodyStrong, { color: theme.colors.warning }]}>
            {review.incompleteRequiredSteps.length} section{review.incompleteRequiredSteps.length === 1 ? '' : 's'} need{review.incompleteRequiredSteps.length === 1 ? 's' : ''} attention
          </Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>
            Complete every highlighted section below before submitting.
          </Text>
        </View>
      )}

      {stepInfo('resume').exists ? (
        <SectionCard title="Resume" {...stepInfo('resume')} stepId="resume" onEdit={onEdit}>
          <FieldRow label="File" value={resumeDocument?.name} />
        </SectionCard>
      ) : null}

      <SectionCard title="Personal Information" {...stepInfo('personal_info')} stepId="personal_info" onEdit={onEdit}>
        <FieldRow label="Full Legal Name" value={[personalInfo.firstName, personalInfo.middleInitial, personalInfo.lastName].filter(Boolean).join(' ')} />
        <FieldRow label="Date of Birth" value={personalInfo.dateOfBirth ? isoDateToSlash(personalInfo.dateOfBirth) : null} />
        <FieldRow label="Email" value={personalInfo.email} />
        <FieldRow label="Phone" value={personalInfo.phone} />
        <FieldRow label="Address" value={[personalInfo.address, personalInfo.city, personalInfo.state, personalInfo.zip].filter(Boolean).join(', ')} />
      </SectionCard>

      <SectionCard title="Applicant Details" {...stepInfo('employment_application')} stepId="employment_application" onEdit={onEdit}>
        <FieldRow label="Position Applied For" value={formatOptionValues(employmentApplication.positionApplied, POSITION_OPTIONS)} />
        <FieldRow label="Specialty / Unit Preference" value={formatOptionValues(employmentApplication.specialtyPreference, SPECIALTY_OPTIONS)} />
        <FieldRow label="Employment Type" value={formatOptionValues(employmentApplication.employmentType, EMPLOYMENT_TYPE_OPTIONS, LEGACY_EMPLOYMENT_TYPE_LABELS)} />
        <FieldRow label="Shift Preference" value={formatOptionValues(employmentApplication.shiftPreference, SHIFT_PREFERENCE_OPTIONS, LEGACY_SHIFT_PREFERENCE_LABELS)} />
        <FieldRow label="License / Certification" value={[formatOptionValues(employmentApplication.licenseType, LICENSE_TYPE_OPTIONS, LEGACY_LICENSE_TYPE_LABELS), employmentApplication.licenseNumber, employmentApplication.licenseState].filter(Boolean).join(' · ')} />
        <FieldRow label="License Expiration" value={isoDateToDisplay(employmentApplication.licenseExpiration)} />
        <FieldRow label="Emergency Contact" value={[employmentApplication.emergencyContactName, employmentApplication.emergencyContactRelationship].filter(Boolean).join(', ')} />
      </SectionCard>

      {['employment_ref_1', 'employment_ref_2', 'employment_ref_3'].map((refId) => {
        const info = stepInfo(refId);
        const ref = employmentReferences[refId];
        if (!info.exists) return null;
        return (
          <SectionCard key={refId} title={`Employment Reference #${refId.slice(-1)}`} {...info} stepId={refId} onEdit={onEdit}>
            <FieldRow label="Supervisor" value={[ref?.supervisorName, ref?.supervisorTitle].filter(Boolean).join(', ')} />
            <FieldRow label="Facility / Employer" value={ref?.employerName} />
            <FieldRow label="Phone" value={ref?.supervisorPhone} />
            {ref?.supervisorEmail?.trim() ? <FieldRow label="Email" value={ref.supervisorEmail} /> : null}
          </SectionCard>
        );
      })}

      <SectionCard title="Authorizations & Acknowledgements" completed={appStatementInfo.completed && backgroundAuthInfo.completed && healthInfoAuthInfo.completed && pborInfo.completed} required>
        <CheckRow label="Applicant Statement" checked={!!acknowledgements.application_statement?.checked} />
        <CheckRow label="Background Investigation & Drug/Alcohol Testing Authorization" checked={!!acknowledgements.background_auth?.checked} />
        {healthInfoAuthInfo.exists ? <CheckRow label="Disclosure of Health Information Authorization" checked={!!acknowledgements.health_info_auth?.checked} /> : null}
        {pborInfo.exists ? <CheckRow label="Patient Bill of Rights" checked={!!acknowledgements.patient_bill_of_rights?.checked} /> : null}
      </SectionCard>

      {VACCINE_STEPS.some((v) => stepInfo(v.stepId).exists) ? (
        <SectionCard
          title="Vaccine Declarations"
          completed={VACCINE_STEPS.every((v) => !stepInfo(v.stepId).exists || stepInfo(v.stepId).completed)}
          required
        >
          {VACCINE_STEPS.filter((v) => stepInfo(v.stepId).exists).map(({ stepId, name }) => {
            const entry = acknowledgements[stepId];
            const label = entry?.decision === 'providing_proof' ? 'Providing Proof' : entry?.decision === 'declining' ? 'Declining' : 'Not yet completed';
            return <FieldRow key={stepId} label={name} value={label} />;
          })}
        </SectionCard>
      ) : null}

      <SectionCard title="Tax Forms / W-4" {...stepInfo('w4')} stepId="w4" onEdit={onEdit}>
        <FieldRow label="Name" value={[w4Data.firstNameMI, w4Data.lastName].filter(Boolean).join(' ')} />
        <FieldRow
          label="Filing Status"
          value={
            w4Data.exemptFromWithholding
              ? 'Not required — claiming exemption from withholding'
              : w4Data.filingStatus ? (FILING_STATUS_LABELS[w4Data.filingStatus] ?? w4Data.filingStatus) : null
          }
        />
        {w4Data.exemptFromWithholding ? <CheckRow label="Claiming exemption from withholding" checked /> : null}
        <CheckRow label="Signed electronically" checked={!!w4Data.typedSignature?.trim()} />
      </SectionCard>

      <SectionCard title="Form I-9 (Section 1)" {...stepInfo('i9')} stepId="i9" onEdit={onEdit}>
        <FieldRow label="Status" value={i9Data.citizenshipStatus ? CITIZENSHIP_LABELS[i9Data.citizenshipStatus] : null} />
        <CheckRow
          label="Signed electronically"
          checked={(i9Data.i9SignatureType === 'drawn' && !!i9Data.i9SignatureDataUrl) || (i9Data.i9SignatureType === 'typed' && !!i9Data.i9TypedSignature?.trim())}
        />
      </SectionCard>

      <SectionCard title="Direct Deposit" {...directDepositInfo} stepId="direct_deposit" onEdit={onEdit}>
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {directDepositInfo.completed ? 'Bank information and account verification on file.' : 'Bank information not yet completed.'}
        </Text>
      </SectionCard>

      <SectionCard title="Documents & Credentials" {...stepInfo('documents')} stepId="documents" onEdit={onEdit}>
        <CheckRow label="Identity & Work Authorization (I-9)" checked={!!uploadedDocuments.listA || (!!uploadedDocuments.listB && !!uploadedDocuments.listC)} />
        <CheckRow label="Professional License / Certification" checked={!!uploadedDocuments.nursingLicense} />
        <CheckRow label="CPR / BLS Certification" checked={!!uploadedDocuments.cprCertification} />
      </SectionCard>

      {jcahoInfo.exists ? (
        <SectionCard title="JCAHO / TJC Standards Review" {...jcahoInfo} stepId="jcaho_review" onEdit={onEdit}>
          <CheckRow label="Reviewed and acknowledged" checked={!!acknowledgements.jcaho_review?.checked} />
        </SectionCard>
      ) : null}

      <SectionCard title="Safety & Education Acknowledgements" {...safetyInfo} stepId="safety_acknowledgements" onEdit={onEdit}>
        <FieldRow
          label="Topics acknowledged"
          value={`${[
            safetyEducation.patientSafety, safetyEducation.infectionControl, safetyEducation.fireSafety, safetyEducation.patientRightsHipaa,
            safetyEducation.workplaceViolence, safetyEducation.backSafety, safetyEducation.hazardousMaterials, safetyEducation.documentationStandards,
          ].filter(Boolean).length} of 8`}
        />
        <CheckRow label="Final attestation" checked={!!safetyEducation.examAttestation} />
      </SectionCard>

      {review.optionalSteps.length > 0 ? (
        <SectionCard title="Optional" completed required={false}>
          {review.optionalSteps.map((s) => (
            <FieldRow key={s.id} label={s.label} value={s.completed ? 'Completed' : 'Not completed — optional, does not block submission'} />
          ))}
        </SectionCard>
      ) : null}

      <View style={{ marginTop: theme.spacing.sm, marginBottom: theme.spacing.lg, padding: theme.spacing.md, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md }}>
        <Text style={[theme.typography.caption, { color: theme.colors.text, lineHeight: 20 }]}>
          By submitting, you certify that all information provided is true and accurate to the best of your knowledge.
          False statements may result in termination and are subject to penalties under federal law. Paramount Care
          Staffing, LLC will review your application within 1–2 business days.
        </Text>
      </View>

    </Screen>
  );
}
