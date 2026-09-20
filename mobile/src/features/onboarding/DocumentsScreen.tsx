import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Image, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { ErrorState } from '../../components/StatusStates';
import { useTheme } from '../../theme/ThemeProvider';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useDocumentsForm } from './useDocumentsForm';
import type { DocumentSlotDef } from '../documents/documentSlots';
import type { useDocumentSlot } from '../documents/useDocumentSlot';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One document requirement's full card — capture/select, preview,
 * uploading/associating, uploaded+replace/remove, or failed+retry. The
 * exact same state machine DirectDepositScreen's own Voided Check section
 * renders, generalized so every slot in the Documents checklist looks and
 * behaves identically (M13/M14: one reusable capture+upload+association
 * lifecycle, not five bespoke ones).
 */
function DocumentSlotCard({ slot, hook, badge }: { slot: DocumentSlotDef; hook: ReturnType<typeof useDocumentSlot>; badge?: string }) {
  const theme = useTheme();
  const { capture, status, file, errorMessage } = hook;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.md,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.spacing.xs }}>
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, flex: 1 }]}>{slot.label}</Text>
        {badge ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceAlt, marginLeft: theme.spacing.xs }}>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontWeight: '700' }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>{slot.description}</Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm, fontStyle: 'italic' }]}>
        Examples: {slot.examples}
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
              accessibilityLabel={`Preview of the ${slot.label} you just captured`}
              style={{ width: '100%', height: 180, borderRadius: theme.radii.md, marginBottom: theme.spacing.sm, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="contain"
            />
          )}
          {capture.pending.issue ? (
            <Text accessibilityLiveRegion="assertive" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
              {capture.pending.issue}
            </Text>
          ) : (
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>
              Make sure the entire document is visible and easy to read before continuing.
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

      {!capture.pending && status === 'idle' ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Button label="Scan Document" onPress={capture.scan} accessibilityHint="Opens your device's document scanner" />
          <Button label="Take a Photo" variant="secondary" onPress={capture.takePhoto} />
          <Button label="Choose from Photos" variant="secondary" onPress={capture.pickFromLibrary} />
          <Button label="Choose a PDF" variant="secondary" onPress={capture.pickDocument} />
        </View>
      ) : null}

      {!capture.pending && (status === 'uploading' || status === 'associating') ? (
        <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>{status === 'uploading' ? 'Uploading…' : 'Saving…'}</Text>
      ) : null}

      {!capture.pending && status === 'uploaded' && file ? (
        <View>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{file.name}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>{formatBytes(file.size)} — Uploaded</Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Replace" variant="secondary" onPress={capture.scan} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Remove" variant="danger" onPress={hook.remove} />
            </View>
          </View>
        </View>
      ) : null}

      {!capture.pending && status === 'failed' ? (
        <ErrorState message={errorMessage ?? 'Upload failed. Please try again.'} onRetry={hook.retry} />
      ) : null}
    </View>
  );
}

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
