import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from 'react-native';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/Button';
import { StepActionBar } from '../../components/StepActionBar';
import { FormFooterStatus } from '../../components/FormFooterStatus';
import { RevealOnShow } from '../../components/RevealOnShow';
import { useTheme } from '../../theme/ThemeProvider';
import { useStepNavigation } from './stepNavigation';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useDocumentsForm } from './useDocumentsForm';
import { useSession } from './SessionContext';
import { DocumentSlotCard } from '../../components/DocumentSlotCard';
import { CheckboxField } from '../../components/CheckboxField';
import { attachmentSummary, buildDocumentChecklist, type ChecklistItem } from '../documents/documentChecklist';
import { I9_REUSE_OPTIONS } from '../documents/documentSlots';

const REUSED_LABEL: Record<string, string> = {
  drivers_license: "Driver's License from Identity Documents",
  social_security_card: 'Social Security Card from Identity Documents',
};

/** The applicant confirms the card qualifies for List C (Form I-9 accepts a
 * Social Security card only without an employment restriction). */
const UNRESTRICTED_CARD_CONFIRMATION =
  'My Social Security card is not printed with "NOT VALID FOR EMPLOYMENT", "VALID FOR WORK ONLY WITH INS AUTHORIZATION" or "VALID FOR WORK ONLY WITH DHS AUTHORIZATION".';

/**
 * Documents & Credentials — a guided checklist over the same required
 * slots, rules, and upload pipeline as before (useDocumentsForm):
 *  - the I-9 identity choice first (List A, or List B + List C), then the
 *    chosen path's upload(s), then the packet's credentials in order;
 *  - ONE active upload card at a time — the first incomplete required item;
 *  - a requirement is one row however many attachments it holds: completed
 *    ones collapse to a compact row (✓, attachment summary, Manage), and
 *    Manage reopens the full card (Upload More, Replace, Remove) until Done;
 *  - optional documents wait as compact rows, opened with Add;
 *  - after each upload finishes the next requirement opens and is scrolled
 *    into view.
 *
 * No unsaved-changes guard: every upload persists itself the moment it
 * succeeds, so leaving this screen can never discard anything.
 */
export default function DocumentsScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
  const { isConnected } = useNetworkStatus();
  const form = useDocumentsForm();

  const { session } = useSession();
  const checklist = buildDocumentChecklist({
    requiredSlots: form.requiredSlots,
    optionalSlots: form.optionalSlots,
    identityPath: form.identityPath,
    documents: form.documents,
    formData: session?.formData,
    reusedFrom: {
      ...(form.reuse.list_b.active ? { list_b: I9_REUSE_OPTIONS.list_b.source } : {}),
      ...(form.reuse.list_c.active ? { list_c: I9_REUSE_OPTIONS.list_c.source } : {}),
    },
  });
  // List C reuse needs the applicant's own confirmation first.
  const [cardUnrestricted, setCardUnrestricted] = useState(false);

  // The item the applicant opened with Manage/Add, until they tap Done.
  const [reopened, setReopened] = useState<string | null>(null);
  function isOpen(item: ChecklistItem): boolean {
    if (item.docType === checklist.activeDocType || reopened === item.docType) return true;
    // A multi-file upload stays open until its last file has finished.
    const status = form.slotHooks[item.docType]?.status;
    return status === 'uploading' || status === 'associating';
  }

  // Scroll-to-first-error targets: the identity section and each item.
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const setSectionOffset = useCallback((key: string, e: LayoutChangeEvent) => {
    sectionOffsets.current[key] = e.nativeEvent.layout.y;
  }, []);

  function scrollToFirstError() {
    const identityInvalid = !!form.errors.i9 || !!form.identityPathError;
    const firstInvalid = identityInvalid ? 'identity' : checklist.items.find((i) => !i.done && !i.optional)?.docType;
    const y = firstInvalid ? sectionOffsets.current[firstInvalid] : undefined;
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
  }

  async function handleSaveProgress() {
    const outcome = await form.saveProgress();
    if (outcome.kind === 'saved') nav.leave();
  }

  async function handleComplete() {
    const outcome = await form.complete();
    if (outcome.kind === 'saved') nav.afterComplete();
    else if (outcome.kind === 'invalid') scrollToFirstError();
  }

  const caption = (text: string, color = theme.colors.textMuted) => (
    <Text style={[theme.typography.caption, { color, marginBottom: theme.spacing.sm }]}>{text}</Text>
  );

  /** For List B / List C: use the matching Identity Documents upload instead
   * of uploading it again — only if the applicant chooses to — or, once
   * chosen, say so (uploading a different document below replaces it). */
  function renderReuse(docType: 'list_b' | 'list_c') {
    const option = I9_REUSE_OPTIONS[docType];
    const state = form.reuse[docType];
    if (state.active) {
      return (
        <View testID={`reuse-active-${docType}`} style={{ marginBottom: theme.spacing.sm, padding: theme.spacing.md, borderRadius: theme.radii.md, backgroundColor: theme.colors.successSurface }}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.success }]}>✓ {option.inUse}</Text>
          {caption('To use a different document instead, upload it below.')}
          <Button label="Stop using it" variant="secondary" disabled={form.reuseBusy} onPress={() => void form.setReuse(docType, false)} />
        </View>
      );
    }
    if (!state.available) return null;
    const needsConfirmation = docType === 'list_c';
    return (
      <View testID={`reuse-offer-${docType}`} style={{ marginBottom: theme.spacing.sm }}>
        {docType === 'list_b'
          ? caption("A driver's license issued by a U.S. state or outlying possession is a List B document.")
          : caption('A Social Security card is a List C document only if it has no employment restriction.')}
        {needsConfirmation ? (
          <CheckboxField label={UNRESTRICTED_CARD_CONFIRMATION} value={cardUnrestricted} onChange={setCardUnrestricted} />
        ) : null}
        <Button
          label={option.useLabel}
          disabled={form.reuseBusy || (needsConfirmation && !cardUnrestricted)}
          onPress={() => void form.setReuse(docType, true, needsConfirmation ? cardUnrestricted : undefined)}
        />
        {form.reuseError ? caption(form.reuseError, theme.colors.danger) : null}
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.sm }]}>Or upload a different document:</Text>
      </View>
    );
  }

  function renderItem(item: ChecklistItem, index: number) {
    const hook = form.slotHooks[item.docType];
    const error = item.group === 'credential' ? form.errors[item.slot.formDataField] : undefined;
    const open = isOpen(item);
    return (
      <View key={item.docType} onLayout={(e) => setSectionOffset(item.docType, e)} style={{ marginBottom: theme.spacing.sm }}>
        <RevealOnShow when={open} testID={`doc-open-${item.docType}`}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
            {index + 1}. {item.slot.label}
          </Text>
          {item.docType === 'list_b' || item.docType === 'list_c' ? renderReuse(item.docType) : null}
          <DocumentSlotCard slot={item.slot} hook={hook} error={error} />
          {reopened === item.docType ? (
            <Button label="Done" variant="secondary" onPress={() => setReopened(null)} />
          ) : null}
        </RevealOnShow>
        {!open ? (
          <View
            testID={`doc-row-${item.docType}`}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: theme.spacing.md,
              borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface,
            }}
          >
            <Text
              accessibilityLabel={item.done ? 'Uploaded' : 'Not uploaded yet'}
              style={[theme.typography.bodyStrong, { color: item.done ? theme.colors.success : theme.colors.textMuted, width: 24 }]}
            >
              {item.done ? '✓' : item.optional ? '–' : `${index + 1}`}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.bodyStrong, { color: item.done ? theme.colors.text : theme.colors.textMuted }]}>{item.slot.label}</Text>
              <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                {item.reusedFrom ? REUSED_LABEL[item.reusedFrom] : item.done ? attachmentSummary(item.attachments) : item.optional ? 'Optional' : 'Up next'}
              </Text>
              {error ? <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text> : null}
            </View>
            {item.done || item.optional ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.done ? 'Manage' : 'Add'} ${item.slot.label}`}
                hitSlop={8}
                onPress={() => setReopened(item.docType)}
                style={{ minHeight: theme.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>{item.done ? 'Manage' : 'Add'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

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
      <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Documents & Credentials</Text>
      <Text accessibilityLiveRegion="polite" style={[theme.typography.body, { color: theme.colors.textMuted, marginBottom: theme.spacing.lg }]}>
        {checklist.completedRequired} of {checklist.totalRequired} required documents uploaded
      </Text>

      {checklist.allComplete ? (
        <View
          testID="documents-complete"
          style={{ marginBottom: theme.spacing.lg, padding: theme.spacing.md, backgroundColor: theme.colors.successSurface, borderRadius: theme.radii.md }}
        >
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.success }]}>All required documents uploaded</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginTop: theme.spacing.xs }]}>
            Tap {form.isCompleted ? 'Save' : 'Continue'} to finish this step.
          </Text>
        </View>
      ) : null}

      {checklist.identityRequired ? (
        <View style={{ marginBottom: theme.spacing.md }} onLayout={(e) => setSectionOffset('identity', e)}>
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Form I-9: Identity & Work Authorization</Text>
          {caption('Choose one way to verify your identity and work authorization under the federal Form I-9 rules: one List A document, or one List B document and one List C document. This is your own choice — documents you uploaded in Identity Documents are used here only if you select them.')}
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="List A document" variant={form.identityPath === 'list_a' ? 'primary' : 'secondary'} onPress={() => form.setIdentityPath('list_a')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="List B + List C documents" variant={form.identityPath === 'list_b_c' ? 'primary' : 'secondary'} onPress={() => form.setIdentityPath('list_b_c')} />
            </View>
          </View>
          {checklist.needsIdentityChoice ? caption('Select an option above to start.') : null}
          {form.identityPath === 'list_a' && (form.slotHooks.list_b.file || form.slotHooks.list_c.file)
            ? caption('Your previously attached List B/List C document(s) will be removed automatically once your List A document is uploaded.')
            : null}
          {form.identityPath === 'list_b_c' && form.slotHooks.list_a.file
            ? caption('Your previously attached List A document will be removed automatically once both List B and List C are uploaded.')
            : null}
          {form.errors.i9 ? caption(form.errors.i9, theme.colors.danger) : form.identityPathError ? caption(form.identityPathError, theme.colors.danger) : null}
        </View>
      ) : null}

      {checklist.items.map(renderItem)}
    </Screen>
  );
}
