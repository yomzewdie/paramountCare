import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { useTheme } from '../theme/ThemeProvider';

interface SignaturePadProps {
  /** An existing data URL to restore (e.g. reopening a step with an
   * already-drawn signature) — passed straight through to the canvas's own
   * `dataURL` prop, which it uses to pre-render without a reload. */
  value: string;
  onChange: (dataUrl: string) => void;
  onClear: () => void;
  error?: string;
}

/**
 * Finger/stylus signature capture, matching the existing web app's own
 * drawn-signature output format exactly: `imageType="image/png"` guarantees
 * the `data:image/png;base64,...` prefix the PDF generator's strict string
 * check requires (worker/src/services/i9pdf.ts). Built on
 * `react-native-signature-canvas` (WebView-based, Expo SDK 57-compatible —
 * confirmed against `react-native-webview@13.16.1`, Expo's own bundled
 * version) rather than a custom PanResponder/SVG implementation, since a
 * purpose-built library that already outputs the exact required format is
 * less total dependency surface than building PNG-encoding from raw touch
 * points by hand. See ADR-024.
 *
 * The library's own built-in Clear/Confirm buttons are hidden (`webStyle`)
 * in favor of this app's own themed controls, consistent with every other
 * component here being custom-styled rather than a third-party default.
 */
export function SignaturePad({ value, onChange, onClear, error }: SignaturePadProps) {
  const theme = useTheme();
  const ref = useRef<SignatureViewRef>(null);

  function handleClear() {
    ref.current?.clearSignature();
    onClear();
  }

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <View
        style={{
          height: 180,
          borderWidth: 1,
          borderRadius: theme.radii.sm,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          overflow: 'hidden',
          backgroundColor: theme.colors.surface,
        }}
      >
        <SignatureCanvas
          ref={ref}
          dataURL={value || undefined}
          imageType="image/png"
          backgroundColor={theme.colors.surface}
          penColor={theme.colors.text}
          trimWhitespace
          autoClear={false}
          descriptionText=""
          webStyle=".m-signature-pad--footer { display: none; margin: 0; } .m-signature-pad--body { border: none; } body,html { background-color: transparent; }"
          onEnd={() => ref.current?.readSignature()}
          onOK={(dataUrl) => onChange(dataUrl)}
          onEmpty={() => onChange('')}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: theme.spacing.xs }}>
        {error ? (
          <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, flex: 1 }]}>
            {error}
          </Text>
        ) : (
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted, flex: 1 }]}>Sign above with your finger or stylus.</Text>
        )}
        <Pressable
          onPress={handleClear}
          accessibilityRole="button"
          accessibilityLabel="Clear signature"
          hitSlop={8}
          style={{ minHeight: theme.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>Clear</Text>
        </Pressable>
      </View>
    </View>
  );
}
