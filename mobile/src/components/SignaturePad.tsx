import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { useTheme } from '../theme/ThemeProvider';
import { useScreenScroll } from './keyboard/KeyboardScrollContext';

interface SignaturePadProps {
  /** An existing data URL to restore (e.g. reopening a step with an
   * already-drawn signature). */
  value: string;
  onChange: (dataUrl: string) => void;
  onClear: () => void;
  error?: string;
}

// The library's own Clear/Confirm footer is hidden in favor of this app's
// themed controls. `touch-action: none` keeps the WebView from treating a
// stroke as a page pan/zoom.
const WEB_STYLE =
  '.m-signature-pad--footer { display: none; margin: 0; } .m-signature-pad--body { border: none; } ' +
  'body,html { background-color: transparent; } canvas { touch-action: none; }';

// Stroke tuning (signature_pad options the library exposes). minDistance 5
// (the default) drops every touch point closer than 5px to the previous one,
// so slow signatures came out as visible straight segments; 1.5 keeps curves
// smooth. A higher minimum width keeps fast strokes from thinning into
// faint, broken-looking lines.
export const MIN_DISTANCE = 1.5;
export const MIN_WIDTH = 1.2;
export const MAX_WIDTH = 3;

/**
 * Finger/stylus signature capture. Output format is unchanged —
 * `data:image/png;base64,...` (`imageType="image/png"`), exactly what the
 * I-9 PDF generator requires (worker/src/services/i9pdf.ts) — so stored
 * signatures and generated PDFs are fully compatible. Built on
 * `react-native-signature-canvas` (signature_pad in a WebView). See ADR-024.
 *
 * Responsiveness (physical-device UAT):
 *  - Drawing happens entirely inside the WebView; React state changes only
 *    once per finished stroke (never per touch point).
 *  - The image this pad emits is NOT fed back into the canvas. That library
 *    re-draws its canvas from `dataURL` whenever the prop changes, and the
 *    emitted image is whitespace-trimmed — feeding it back re-rasterized and
 *    re-positioned the whole signature after every stroke, making the next
 *    stroke start on a shifted, blurred canvas. The canvas is only
 *    (re)loaded from a value that came from outside (initial restore, or the
 *    form replacing it, e.g. "discard my changes").
 *  - While a stroke is in progress the enclosing Screen's scrolling is
 *    locked, so a vertical stroke never turns into a scroll.
 */
export function SignaturePad({ value, onChange, onClear, error }: SignaturePadProps) {
  const theme = useTheme();
  const { setScrollLocked } = useScreenScroll();
  const ref = useRef<SignatureViewRef>(null);

  // `emitted`: the last value this pad itself produced (or already shows).
  // `restoreDataUrl`: what the canvas should load — only ever a value that
  // came from outside (see above). Adjusted during render when `value`
  // changes, per React's "adjusting state when a prop changes" pattern.
  const [emitted, setEmitted] = useState(value);
  const [restoreDataUrl, setRestoreDataUrl] = useState(value);
  const [clearRequests, setClearRequests] = useState(0);
  if (value !== emitted) {
    setEmitted(value);
    if (value) setRestoreDataUrl(value);
    else setClearRequests((n) => n + 1);
  }

  // The form cleared the value from outside: clear the canvas too.
  useEffect(() => {
    if (clearRequests > 0) ref.current?.clearSignature();
  }, [clearRequests]);

  // Never leave the screen unscrollable if the pad goes away mid-stroke.
  useEffect(() => () => setScrollLocked(false), [setScrollLocked]);

  const handleBegin = useCallback(() => setScrollLocked(true), [setScrollLocked]);
  const handleEnd = useCallback(() => {
    setScrollLocked(false);
    ref.current?.readSignature();
  }, [setScrollLocked]);
  const handleOK = useCallback(
    (dataUrl: string) => {
      setEmitted(dataUrl);
      onChange(dataUrl);
    },
    [onChange],
  );
  const handleEmpty = useCallback(() => {
    setScrollLocked(false);
    setEmitted('');
    onChange('');
  }, [onChange, setScrollLocked]);

  function handleClear() {
    ref.current?.clearSignature();
    setEmitted('');
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
          dataURL={restoreDataUrl || undefined}
          imageType="image/png"
          backgroundColor={theme.colors.surface}
          penColor={theme.colors.text}
          minDistance={MIN_DISTANCE}
          minWidth={MIN_WIDTH}
          maxWidth={MAX_WIDTH}
          trimWhitespace
          autoClear={false}
          descriptionText=""
          webStyle={WEB_STYLE}
          webviewProps={{ bounces: false, overScrollMode: 'never' }}
          onBegin={handleBegin}
          onEnd={handleEnd}
          onOK={handleOK}
          onEmpty={handleEmpty}
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
