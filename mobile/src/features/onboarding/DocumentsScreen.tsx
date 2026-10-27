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
import { DocumentSlotCard } from '../../components/DocumentSlotCard';
import { buildDocumentChecklist, type ChecklistItem } from '../documents/documentChecklist';

/**
 * Documents & Credentials — a guided checklist over the same required
 * slots, rules, and upload pipeline as before (useDocumentsForm):
 *  - the I-9 identity choice first (List A, or List B + List C), then the
 *    chosen path's upload(s), then the packet's credentials in order;
 *  - ONE active upload card at a time — the first incomplete requirement;
 *  - completed uploads collapse to a compact row (✓, file name, Replace);
 *    Replace reopens the full card (with Remove), and it collapses again
 *    once the new file is uploaded;
 *  - after each upload the next requirement opens and is scrolled into view.
 *
 * No unsaved-changes guard: every upload persists itself the moment it
 * succeeds, so leaving this screen can never discard anything.
 */
export default function DocumentsScreen() {
  const theme = useTheme();
  const nav = useStepNavigation();
  const { isConnected } = useNetworkStatus();
  const form = useDocumentsForm();

  const checklist = buildDocumentChecklist({ requiredSlots: form.requiredSlots, identityPath: form.identityPath, documents: form.documents });

  // A completed item the applicant reopened with Replace, and the file it
  // held then — once a different file is uploaded it collapses again.
  const [reopened, setReopened] = useState<{ docType: string; objectKey: string | undefined } | null>(null);
  function isOpen(item: ChecklistItem): boolean {
    if (item.docType === checklist.activeDocType) return true;
    if (reopened?.docType !== item.docType) return false;
    return !(item.done && item.file?.objectKey !== reopened.objectKey);
  }

  // Scroll-to-first-error targets: the identity section and each item.
  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({});
  const setSectionOffset = useCallback((key: string, e: LayoutChangeEvent) => {
    sectionOffsets.current[key] = e.nativeEvent.layout.y;
  }, []);

  function scrollToFirstError() {
    const identityInvalid = !!form.errors.i9 || !!form.identityPathError;
    const firstInvalid = identityInvalid ? 'identity' : checklist.items.find((i) => !i.done)?.docType;
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
          <DocumentSlotCard slot={item.slot} hook={hook} error={error} />
          {item.done && reopened?.docType === item.docType ? (
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
              {item.done ? '✓' : `${index + 1}`}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.bodyStrong, { color: item.done ? theme.colors.text : theme.colors.textMuted }]}>{item.slot.label}</Text>
              <Text numberOfLines={1} style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                {item.done ? item.file?.name : 'Up next'}
              </Text>
              {error ? <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>{error}</Text> : null}
            </View>
            {item.done ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Replace ${item.slot.label}`}
                hitSlop={8}
                onPress={() => setReopened({ docType: item.docType, objectKey: item.file?.objectKey })}
                style={{ minHeight: theme.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>Replace</Text>
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
          <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>Identity & Work Authorization</Text>
          {caption('Choose one way to verify your identity and work authorization.')}
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
