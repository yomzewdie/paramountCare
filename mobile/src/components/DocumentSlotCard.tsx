import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { ErrorState } from './StatusStates';
import type { useDocumentSlot } from '../features/documents/useDocumentSlot';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const THUMBNAIL_SIZE = 96;

/**
 * One document requirement's full card — the one upload UI every onboarding
 * screen uses: the same capture actions (only those the requirement allows),
 * preview, uploading/saving, the requirement's attachments as compact rows
 * with Replace/Remove, Upload More, and failed+retry.
 */
/** The part of a slot definition the card actually renders — DocumentSlotDef
 * satisfies it, and so does a vaccination-proof slot (which has no separate
 * description/examples because its screen already shows that copy). */
export interface DocumentSlotCardSlot {
  label: string;
  description?: string;
  examples?: string;
}

export function DocumentSlotCard({
  slot,
  hook,
  badge,
  required,
  error,
  previewHint = 'Make sure the entire document is visible and easy to read before continuing.',
}: {
  slot: DocumentSlotCardSlot;
  hook: ReturnType<typeof useDocumentSlot>;
  badge?: string;
  /** Shows the required marker next to the label (presentation only). */
  required?: boolean;
  /** Inline validation message (e.g. "Please upload your proof…"). */
  error?: string;
  /** Shown under a preview, before the applicant confirms it. */
  previewHint?: string;
}) {
  const theme = useTheme();
  const { capture, status, attachments, errorMessage, requirement, progress, replacing, addingMore } = hook;
  const pendingItems = capture.pendingItems;
  const firstPending = pendingItems[0];
  const issue = pendingItems.find((item) => item.issue)?.issue;

  const isChoosing = !capture.pending && (status === 'idle' || (status === 'uploaded' && (!!replacing || addingMore)));
  const showAttachments = !capture.pending && !replacing && attachments.length > 0 && status !== 'uploading' && status !== 'associating';
  // A failure stays on screen beside whatever already saved; a failed
  // removal (nothing queued) has nothing to retry or cancel.
  const failedUpload = !capture.pending && status === 'failed';

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
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, flex: 1 }]}>
          {slot.label}
          {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
        </Text>
        {badge ? (
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceAlt, marginLeft: theme.spacing.xs }}>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, fontWeight: '700' }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {slot.description ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.xs }]}>{slot.description}</Text>
      ) : null}
      {slot.examples ? (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm, fontStyle: 'italic' }]}>
          Examples: {slot.examples}
        </Text>
      ) : null}

      {capture.permissionError ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
          {capture.permissionError}
        </Text>
      ) : null}

      {firstPending ? (
        <View>
          {pendingItems.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing.sm }} testID="pending-thumbnails">
              {pendingItems.map((item, index) => (
                <View key={item.picked.uri} style={{ marginRight: theme.spacing.sm, width: THUMBNAIL_SIZE }}>
                  <Image
                    source={{ uri: item.picked.uri }}
                    accessibilityLabel={`Preview of photo ${index + 1} of ${pendingItems.length}`}
                    style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surfaceAlt, borderWidth: item.issue ? 2 : 0, borderColor: theme.colors.danger }}
                    resizeMode="cover"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`} hitSlop={8} onPress={() => capture.removePending(index)}>
                    <Text style={[theme.typography.caption, { color: theme.colors.danger, textAlign: 'center', marginTop: theme.spacing.xs }]}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : !firstPending.picked.type.startsWith('image/') ? (
            <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>
              {firstPending.picked.name}{firstPending.pageCount ? ` — ${firstPending.pageCount} pages` : ''}
            </Text>
          ) : (
            <Image
              source={{ uri: firstPending.picked.uri }}
              accessibilityLabel={`Preview of the ${slot.label} you just captured`}
              style={{ width: '100%', height: 180, borderRadius: theme.radii.md, marginBottom: theme.spacing.sm, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="contain"
            />
          )}
          {issue ? (
            <Text accessibilityLiveRegion="assertive" style={[theme.typography.caption, { color: theme.colors.danger, marginBottom: theme.spacing.sm }]}>
              {issue}
            </Text>
          ) : (
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted, marginBottom: theme.spacing.sm }]}>{previewHint}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Retake" variant="secondary" onPress={capture.retake} accessibilityHint="Discards this capture and lets you try again" />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={pendingItems.length > 1 ? `Use ${pendingItems.length} Photos` : 'Use Document'} onPress={capture.confirmUse} disabled={!!issue} />
            </View>
          </View>
        </View>
      ) : null}

      {!capture.pending && (status === 'uploading' || status === 'associating') ? (
        <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
          {status === 'uploading' ? 'Uploading' : 'Saving'}{progress && progress.total > 1 ? ` ${progress.current} of ${progress.total}` : ''}…
        </Text>
      ) : null}

      {showAttachments ? (
        <View testID="attachment-list" style={{ marginBottom: theme.spacing.xs }}>
          {attachments.map((file) => (
            <View key={file.objectKey ?? file.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>{file.name}</Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{formatBytes(file.size)} — Uploaded</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Replace ${file.name}`}
                hitSlop={8}
                onPress={() => (hook.allowsMultiple ? hook.startReplace(file) : capture.pickDocument())}
                style={{ minHeight: theme.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>Replace</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                hitSlop={8}
                onPress={() => hook.removeAttachment(file)}
                style={{ minHeight: theme.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
              >
                <Text style={[theme.typography.caption, { color: theme.colors.danger, fontWeight: '600' }]}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {replacing && !capture.pending && status === 'uploaded' ? (
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.sm }]}>Replace {replacing.name}</Text>
      ) : null}

      {isChoosing ? (
        <View style={{ gap: theme.spacing.xs }}>
          {requirement.scannerAllowed ? <Button label="Scan Document" onPress={capture.scan} accessibilityHint="Opens your device's document scanner. Multiple pages are saved as one PDF." /> : null}
          {requirement.cameraAllowed ? <Button label="Take a Photo" variant="secondary" onPress={capture.takePhoto} /> : null}
          {requirement.existingPhotoAllowed ? <Button label="Choose from Photos" variant="secondary" onPress={capture.pickFromLibrary} /> : null}
          {requirement.pdfAllowed ? <Button label="Choose File" variant={requirement.scannerAllowed ? 'secondary' : 'primary'} onPress={capture.pickDocument} accessibilityHint="Opens your files to choose a document" /> : null}
          {status === 'uploaded' ? <Button label="Cancel" variant="secondary" onPress={hook.cancelChoosing} /> : null}
        </View>
      ) : null}

      {showAttachments && status === 'uploaded' && !addingMore && hook.canAddMore ? (
        <Button label="Upload More" variant="secondary" onPress={hook.startAddingMore} accessibilityHint="Adds another file to this document" />
      ) : null}

      {failedUpload ? (
        <View>
          <ErrorState message={errorMessage ?? 'Upload failed. Please try again.'} onRetry={hook.retry} />
          <Button label="Cancel" variant="secondary" onPress={hook.cancelFailed} />
        </View>
      ) : !capture.pending && errorMessage ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.sm }]}>{errorMessage}</Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.sm }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
