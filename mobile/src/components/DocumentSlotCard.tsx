import { Image, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { ErrorState } from './StatusStates';
import type { useDocumentSlot } from '../features/documents/useDocumentSlot';

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
}: {
  slot: DocumentSlotCardSlot;
  hook: ReturnType<typeof useDocumentSlot>;
  badge?: string;
  /** Shows the required marker next to the label (presentation only). */
  required?: boolean;
  /** Inline validation message (e.g. "Please upload your proof…"). */
  error?: string;
}) {
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
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.sm }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
