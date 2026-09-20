import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Image, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import type { BankAccountType, DepositAllocationType } from '@pcs/shared';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { SensitiveField } from '../../components/SensitiveField';
import { SelectField } from '../../components/SelectField';
import { FormSection } from '../../components/FormSection';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { useDirectDepositForm } from './useDirectDepositForm';

const ACCOUNT_TYPE_OPTIONS: { value: BankAccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
];

const DEPOSIT_TYPE_OPTIONS: { value: DepositAllocationType; label: string }[] = [
  { value: 'percentage', label: 'Percentage of paycheck' },
  { value: 'dollar', label: 'Fixed dollar amount' },
];

const AUTHORIZATION_TEXT =
  'I authorize my employer to make deposits to my account. In the unlikely event of a deposit error, I authorize my employer to make adjustments to correct the error.';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Visual section order — used only to decide which section to scroll to on
// a failed Complete attempt. SelectField/SensitiveField don't forward
// onLayout the way TextField does (see I9Screen's own SelectField sections
// for the same reason), so this tracks per-SECTION offsets rather than
// per-field — still lands the applicant next to the actual problem, just
// not on the exact input the way the plain-TextField screens can.
type SectionKey = 'employee' | 'primary' | 'additional' | 'voidedCheck' | 'signature';
const SECTION_ORDER: SectionKey[] = ['employee', 'primary', 'additional', 'voidedCheck', 'signature'];
const ERROR_KEY_TO_SECTION: Record<string, SectionKey> = {
  lastName: 'employee', firstName: 'employee',
  primaryBankName: 'primary', primaryAccountType: 'primary', primaryRoutingNumber: 'primary',
  primaryAccountNumber: 'primary', primaryDepositType: 'primary', primaryDepositAmount: 'primary',
  additionalBankName: 'additional', additionalAccountType: 'additional', additionalRoutingNumber: 'additional',
  additionalAccountNumber: 'additional', additionalDepositType: 'additional', additionalDepositAmount: 'additional',
  directDepositProofDocument: 'voidedCheck',
  typedSignature: 'signature', signedDate: 'signature',
};

export default function DirectDepositScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useDirectDepositForm();

  useUnsavedChangesGuard(form.isDirty);

  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SectionKey, number>>>({});
  const setSectionOffset = useCallback((section: SectionKey, e: LayoutChangeEvent) => {
    sectionOffsets.current[section] = e.nativeEvent.layout.y;
  }, []);

  function scrollToFirstError() {
    const errorKeys = Object.keys(form.errors);
    const firstSection = SECTION_ORDER.find((section) => errorKeys.some((key) => ERROR_KEY_TO_SECTION[key] === section));
    const y = firstSection ? sectionOffsets.current[firstSection] : undefined;
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') router.back();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') router.back();
    else if (outcome.kind === 'invalid') scrollToFirstError();
  }

  const { attachment, capture } = form;

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Direct Deposit Authorization</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        It can take one to two payroll periods to process your direct deposit request and for you to begin receiving direct deposits.
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

      <View onLayout={(e) => setSectionOffset('employee', e)}>
      <FormSection title="Employee Information">
        <TextField
          label="Last Name" required
          value={form.data.lastName} onChangeText={form.setLastName}
          onBlur={() => form.blurField('lastName')} error={form.errors.lastName}
          autoCapitalize="words" returnKeyType="next"
        />
        <TextField
          label="First Name" required
          value={form.data.firstName} onChangeText={form.setFirstName}
          onBlur={() => form.blurField('firstName')} error={form.errors.firstName}
          autoCapitalize="words" returnKeyType="next"
        />
        <TextField
          label="Middle Initial" hint="Optional"
          value={form.data.middleInitial} onChangeText={form.setMiddleInitial}
          autoCapitalize="characters" maxLength={1} returnKeyType="next"
        />
        <TextField
          label="Employee Identification Number" hint="Optional — assigned by Paramount Care Staffing, if applicable"
          value={form.data.employeeId} onChangeText={form.setEmployeeId}
          returnKeyType="next"
        />
      </FormSection>
      </View>

      <View onLayout={(e) => setSectionOffset('primary', e)}>
      <FormSection title="Bank Information">
        <TextField
          label="Bank Name" required
          value={form.data.primaryAccount.bankName} onChangeText={(v) => form.setPrimaryField('bankName', v)}
          onBlur={() => form.blurField('primaryBankName')} error={form.errors.primaryBankName}
          returnKeyType="next"
        />
        <SelectField
          label="Account Type" required
          value={form.data.primaryAccount.accountType}
          onValueChange={(v) => { form.setPrimaryField('accountType', v as BankAccountType); form.blurField('primaryAccountType'); }}
          options={ACCOUNT_TYPE_OPTIONS} error={form.errors.primaryAccountType}
        />
        <SensitiveField
          label="Routing/Transit Number" required variant="numeric" maxLength={9}
          value={form.data.primaryAccount.routingNumber} onChangeText={(v) => form.setPrimaryField('routingNumber', v)}
          error={form.errors.primaryRoutingNumber}
          hint="The nine digits to the left of your account number on the bottom of your check. Must begin with 0, 1, 2, or 3."
        />
        <SensitiveField
          label="Account Number" required variant="numeric"
          value={form.data.primaryAccount.accountNumber} onChangeText={(v) => form.setPrimaryField('accountNumber', v)}
          error={form.errors.primaryAccountNumber}
        />
        <SelectField
          label="Amount to be Deposited" required
          value={form.data.primaryAccount.depositType}
          onValueChange={(v) => { form.setPrimaryField('depositType', v as DepositAllocationType); form.blurField('primaryDepositType'); }}
          options={DEPOSIT_TYPE_OPTIONS} error={form.errors.primaryDepositType}
        />
        <TextField
          label={form.data.primaryAccount.depositType === 'dollar' ? 'Dollar Amount ($)' : 'Percentage (%)'}
          required
          value={form.data.primaryAccount.depositAmount}
          onChangeText={(v) => form.setPrimaryField('depositAmount', v)}
          onBlur={() => form.blurField('primaryDepositAmount')}
          error={form.errors.primaryDepositAmount}
          keyboardType="decimal-pad"
        />
      </FormSection>
      </View>

      <View onLayout={(e) => setSectionOffset('additional', e)}>
      <FormSection title="Additional Bank Account (Optional)">
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
          Only fill this in if you want to split your paycheck across a second account.
        </Text>
        <TextField
          label="Bank Name"
          value={form.data.additionalAccount.bankName} onChangeText={(v) => form.setAdditionalField('bankName', v)}
          onBlur={() => form.blurField('additionalBankName')} error={form.errors.additionalBankName}
          returnKeyType="next"
        />
        <SelectField
          label="Account Type"
          value={form.data.additionalAccount.accountType}
          onValueChange={(v) => { form.setAdditionalField('accountType', v as BankAccountType); form.blurField('additionalAccountType'); }}
          options={ACCOUNT_TYPE_OPTIONS} error={form.errors.additionalAccountType}
        />
        <SensitiveField
          label="Routing/Transit Number" variant="numeric" maxLength={9}
          value={form.data.additionalAccount.routingNumber} onChangeText={(v) => form.setAdditionalField('routingNumber', v)}
          error={form.errors.additionalRoutingNumber}
        />
        <SensitiveField
          label="Account Number" variant="numeric"
          value={form.data.additionalAccount.accountNumber} onChangeText={(v) => form.setAdditionalField('accountNumber', v)}
          error={form.errors.additionalAccountNumber}
        />
        <SelectField
          label="Amount to be Deposited"
          value={form.data.additionalAccount.depositType}
          onValueChange={(v) => { form.setAdditionalField('depositType', v as DepositAllocationType); form.blurField('additionalDepositType'); }}
          options={DEPOSIT_TYPE_OPTIONS} error={form.errors.additionalDepositType}
        />
        <TextField
          label={form.data.additionalAccount.depositType === 'dollar' ? 'Dollar Amount ($)' : 'Percentage (%)'}
          value={form.data.additionalAccount.depositAmount}
          onChangeText={(v) => form.setAdditionalField('depositAmount', v)}
          onBlur={() => form.blurField('additionalDepositAmount')}
          error={form.errors.additionalDepositAmount}
          keyboardType="decimal-pad"
        />
      </FormSection>
      </View>

      <View onLayout={(e) => setSectionOffset('voidedCheck', e)}>
      <FormSection title="Voided Check">
        <Text style={[theme.typography.body, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>
          Attach a voided check for this agreement. Deposit slips are not accepted. The information on the check should match what you entered above.
        </Text>

        {capture.permissionError ? (
          <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
            {capture.permissionError}
          </Text>
        ) : null}

        {capture.pending ? (
          <View>
            {capture.pending.picked.type === 'application/pdf' ? (
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>{capture.pending.picked.name}</Text>
            ) : (
              <Image
                source={{ uri: capture.pending.picked.uri }}
                accessibilityLabel="Preview of the document you just captured"
                style={{ width: '100%', height: 220, borderRadius: theme.radii.md, marginBottom: theme.spacing.sm, backgroundColor: theme.colors.surfaceAlt }}
                resizeMode="contain"
              />
            )}

            {capture.pending.issue ? (
              <Text accessibilityLiveRegion="assertive" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
                {capture.pending.issue}
              </Text>
            ) : (
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
                Make sure the entire check is visible and easy to read before continuing.
              </Text>
            )}

            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Retake" variant="secondary" onPress={capture.retake} accessibilityHint="Discards this capture and lets you try again" />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Use Document" onPress={capture.confirmUse} disabled={!!capture.pending.issue} />
              </View>
            </View>
          </View>
        ) : null}

        {!capture.pending && attachment.status === 'idle' ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Button label="Scan Document" onPress={capture.scan} accessibilityHint="Opens your device's document scanner" />
            <Button label="Take a Photo" variant="secondary" onPress={capture.takePhoto} />
            <Button label="Choose from Photos" variant="secondary" onPress={capture.pickFromLibrary} />
            <Button label="Choose a PDF" variant="secondary" onPress={capture.pickDocument} />
          </View>
        ) : null}

        {!capture.pending && (attachment.status === 'uploading' || attachment.status === 'associating') ? (
          <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
            {attachment.status === 'uploading' ? 'Uploading…' : 'Saving…'}
          </Text>
        ) : null}

        {!capture.pending && attachment.status === 'uploaded' && attachment.file ? (
          <View>
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{attachment.file.name}</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
              {formatBytes(attachment.file.size)} — Uploaded
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button label="Replace" variant="secondary" onPress={capture.scan} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Remove" variant="danger" onPress={form.removeProof} />
              </View>
            </View>
          </View>
        ) : null}

        {!capture.pending && attachment.status === 'failed' ? (
          <ErrorState message={attachment.errorMessage ?? 'Upload failed. Please try again.'} onRetry={attachment.retry} />
        ) : null}

        {form.errors.directDepositProofDocument ? (
          <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.sm }]}>
            {form.errors.directDepositProofDocument}
          </Text>
        ) : null}
      </FormSection>
      </View>

      <View onLayout={(e) => setSectionOffset('signature', e)}>
      <FormSection title="Authorization Agreement For Direct Deposit">
        <Text style={[theme.typography.body, { color: theme.colors.text, marginBottom: theme.spacing.md }]}>{AUTHORIZATION_TEXT}</Text>
        <TextField
          label="Electronic Signature" required
          placeholder="Type your full legal name to sign"
          value={form.data.typedSignature} onChangeText={form.setTypedSignature}
          onBlur={() => form.blurField('typedSignature')} error={form.errors.typedSignature}
          autoCapitalize="words" returnKeyType="done"
        />
        {form.data.signedDate ? (
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: -theme.spacing.sm }]}>
            Signed on {form.data.signedDate}
          </Text>
        ) : null}
      </FormSection>
      </View>

    </Screen>
  );
}
