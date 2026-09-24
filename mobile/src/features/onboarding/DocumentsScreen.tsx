import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useDocumentsForm } from './useDocumentsForm';
import { DocumentSlotCard } from '../../components/DocumentSlotCard';

export default function DocumentsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isConnected } = useNetworkStatus();
  const form = useDocumentsForm();

  // No useUnsavedChangesGuard here (unlike every text-field-based step) —
  // there is no local draft to lose: every slot persists itself the
  // instant it's uploaded, so leaving this screen at any point can never
  // discard anything.

  // Section-level (not per-field — there are no text fields here) scroll
  // targets: the identity group, and each individual credential slot,
  // keyed by docType. Mirrors the same onLayout-offset-tracking pattern
  // every other step screen uses for its own scroll-to-first-error.
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const setSectionOffset = useCallback((key: string, e: LayoutChangeEvent) => {
    sectionOffsets.current[key] = e.nativeEvent.layout.y;
  }, []);

  function scrollToFirstError() {
    const identityInvalid = !!form.errors.i9 || !!form.identityPathError;
    const firstCredentialKey = form.visibleCredentialSlots.find((s) => form.errors[s.formDataField])?.docType;
    const key = identityInvalid ? 'identity' : firstCredentialKey;
    const y = key ? sectionOffsets.current[key] : undefined;
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

  const totalRequired = form.visibleIdentitySlots.length > 0 ? 1 + form.visibleCredentialSlots.length : form.visibleCredentialSlots.length;
  const completedRequired =
    (form.visibleIdentitySlots.length > 0 && form.identitySatisfied ? 1 : 0) +
    form.visibleCredentialSlots.filter((s) => form.slotHooks[s.docType]?.status === 'uploaded').length;

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>License & Credential Uploads</Text>
      <Text style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        {completedRequired} of {totalRequired} requirements complete
      </Text>

      {form.identityRequired ? (
        <View style={{ marginBottom: theme.spacing.lg }} onLayout={(e) => setSectionOffset('identity', e)}>
          <Text
            style={[
              theme.typography.caption,
              { color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm },
            ]}
          >
            Required Documents
          </Text>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Identity & Work Authorization</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
            Choose one way to verify your identity and work authorization.
          </Text>

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button
                label="List A document"
                variant={form.identityPath === 'list_a' ? 'primary' : 'secondary'}
                onPress={() => form.setIdentityPath('list_a')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="List B + List C documents"
                variant={form.identityPath === 'list_b_c' ? 'primary' : 'secondary'}
                onPress={() => form.setIdentityPath('list_b_c')}
              />
            </View>
          </View>

          {form.identityPath === 'list_a' ? (
            <>
              <DocumentSlotCard slot={form.visibleIdentitySlots.find((s) => s.docType === 'list_a')!} hook={form.slotHooks.list_a} />
              {form.slotHooks.list_b.file || form.slotHooks.list_c.file ? (
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontStyle: 'italic', marginBottom: theme.spacing.sm }]}>
                  Your previously attached List B/List C document(s) will be removed automatically once your List A document is uploaded here.
                </Text>
              ) : null}
            </>
          ) : null}

          {form.identityPath === 'list_b_c' ? (
            <>
              <DocumentSlotCard slot={form.visibleIdentitySlots.find((s) => s.docType === 'list_b')!} hook={form.slotHooks.list_b} badge="+" />
              <DocumentSlotCard slot={form.visibleIdentitySlots.find((s) => s.docType === 'list_c')!} hook={form.slotHooks.list_c} />
              {form.slotHooks.list_a.file ? (
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontStyle: 'italic', marginBottom: theme.spacing.sm }]}>
                  Your previously attached List A document will be removed automatically once both List B and List C are uploaded here.
                </Text>
              ) : null}
            </>
          ) : null}

          {!form.identityPath ? (
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
              Select an option above to continue.
            </Text>
          ) : null}

          {/* form.errors.i9 (nothing satisfies the requirement at all) takes
              priority; identityPathError only applies once something DOES
              satisfy it — via the path the applicant is actively moving
              away from — and explains why Continue is still blocked for
              the option they actually selected. */}
          {form.errors.i9 ? (
            <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
              {form.errors.i9}
            </Text>
          ) : form.identityPathError ? (
            <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
              {form.identityPathError}
            </Text>
          ) : null}

          {form.visibleCredentialSlots.map((slot) => (
            <View key={slot.docType} style={{ marginTop: theme.spacing.md }} onLayout={(e) => setSectionOffset(slot.docType, e)}>
              <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{slot.label}</Text>
              <DocumentSlotCard slot={slot} hook={form.slotHooks[slot.docType]} />
              {form.errors[slot.formDataField] ? (
                <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: -theme.spacing.xs }]}>
                  {form.errors[slot.formDataField]}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        // No i9Uploads requirement for this packet — still show whichever
        // credential slots ARE required, without the identity heading.
        form.visibleCredentialSlots.length > 0 ? (
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text
              style={[
                theme.typography.caption,
                { color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm },
              ]}
            >
              Required Documents
            </Text>
            {form.visibleCredentialSlots.map((slot) => (
              <View key={slot.docType} style={{ marginBottom: theme.spacing.md }}>
                <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>{slot.label}</Text>
                <DocumentSlotCard slot={slot} hook={form.slotHooks[slot.docType]} />
                {form.errors[slot.formDataField] ? (
                  <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: -theme.spacing.xs }]}>
                    {form.errors[slot.formDataField]}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null
      )}

      {/* No optional document exists in the current Paramount business
          process (confirmed from packets.ts/completion.ts/the existing web
          UploadSection.tsx — all three agree) — this section intentionally
          renders nothing today rather than fabricating one, but the data
          shape (`DocumentSlotDef.optional`) already supports a future
          genuinely-optional document type appearing here. */}

    </Screen>
  );
}
