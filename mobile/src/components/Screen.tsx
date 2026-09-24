import { forwardRef, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useKeyboardOverlap } from './keyboard/useKeyboardOverlap';
import { KeyboardScrollContext } from './keyboard/KeyboardScrollContext';
import { computeScrollDelta } from './keyboard/keyboardMath';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Rendered OUTSIDE the scrollable area, pinned to the bottom of the
   * screen — for a screen's primary action(s) (StepActionBar, a lone
   * Submit button). This is the app's deliberate shared design (the save-
   * error banner and offline notice live in it, right next to the action).
   * It is keyboard-safe because the pinned footer and the scroll area are
   * siblings inside ONE container that this component pads by exactly the
   * amount the keyboard covers it — so the footer is lifted above the
   * keyboard and the scroll area shrinks to what is left, on every screen,
   * with no per-screen code. */
  footer?: ReactNode;
}

/**
 * Base layout for every screen: safe-area aware, keyboard-safe, theme
 * background. Ref-forwarded (to the underlying ScrollView when `scroll` is
 * true, a plain View otherwise) so form screens can scroll to an invalid
 * field on failed validation without duplicating this layout.
 *
 * Keyboard behavior (the single place it lives):
 *  - The keyboard's overlap is MEASURED in window coordinates
 *    (useKeyboardOverlap) rather than using KeyboardAvoidingView, which
 *    mixes a parent-relative frame with a window-relative keyboard position
 *    and so under-pads any screen under a native header or above a tab bar,
 *    and which does nothing on Android under mandatory edge-to-edge.
 *  - A focused input is scrolled fully into view (inputs opt in through
 *    KeyboardScrollContext: TextField, SensitiveField, CodeInput, …).
 *  - Dragging the form dismisses the keyboard (interactive on iOS, on-drag
 *    on Android); tapping empty space dismisses it, while taps on buttons,
 *    checkboxes, and pickers still reach them on the FIRST tap
 *    (`keyboardShouldPersistTaps="handled"`).
 */
export const Screen = forwardRef<ScrollView | View, ScreenProps>(function Screen(
  { children, style, scroll = true, footer, onLayout, ...rest },
  ref,
) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const containerRef = useRef<View>(null);
  const contentRef = useRef<ScrollView | View | null>(null);
  const scrollY = useRef(0);

  const { overlap, keyboardVisible } = useKeyboardOverlap(containerRef, insets.bottom);
  const keyboardVisibleRef = useRef(keyboardVisible);
  keyboardVisibleRef.current = keyboardVisible;

  const setContentRef = useCallback(
    (node: ScrollView | View | null) => {
      contentRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as { current: ScrollView | View | null }).current = node;
    },
    [ref],
  );

  const margin = theme.spacing.lg;

  const ensureFocusedInputVisible = useCallback(() => {
    if (!scroll) return;
    const input = TextInput.State.currentlyFocusedInput?.();
    const scrollNode = contentRef.current as ScrollView | null;
    const viewport = scrollNode?.getNativeScrollRef?.();
    if (!input || !scrollNode || !viewport) return;
    input.measureInWindow((_ix, iy, _iw, ih) => {
      viewport.measureInWindow((_sx, sy, _sw, sh) => {
        const delta = computeScrollDelta({ inputTop: iy, inputBottom: iy + ih, viewportTop: sy, viewportBottom: sy + sh, margin });
        if (delta !== 0) scrollNode.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: true });
      });
    });
  }, [scroll, margin]);

  // The keyboard just appeared/changed: once the padded layout has settled,
  // make sure the field being edited is still visible.
  useEffect(() => {
    if (!keyboardVisible) return;
    const id = requestAnimationFrame(ensureFocusedInputVisible);
    return () => cancelAnimationFrame(id);
  }, [keyboardVisible, overlap, ensureFocusedInputVisible]);

  const keyboardScroll = useMemo(() => ({ ensureFocusedInputVisible }), [ensureFocusedInputVisible]);

  const handleContentLayout = useCallback(
    (e: LayoutChangeEvent) => {
      onLayout?.(e);
      // The scroll viewport just resized (keyboard opened/closed).
      if (keyboardVisibleRef.current) ensureFocusedInputVisible();
    },
    [onLayout, ensureFocusedInputVisible],
  );

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const scrollProps = scroll
    ? {
        contentContainerStyle: [styles.content, { padding: theme.spacing.lg }],
        keyboardShouldPersistTaps: 'handled' as const,
        keyboardDismissMode: Platform.OS === 'ios' ? ('interactive' as const) : ('on-drag' as const),
        onScroll: handleScroll,
        scrollEventThrottle: 16,
      }
    : { style: [styles.content, { padding: theme.spacing.lg }] };
  const Content = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
      <KeyboardScrollContext.Provider value={keyboardScroll}>
        <View ref={containerRef} testID="screen-keyboard-container" style={[styles.flex, { paddingBottom: overlap }]}>
          <Content ref={setContentRef as never} {...scrollProps} {...rest} onLayout={handleContentLayout} style={[!scroll && scrollProps.style, style]}>
            {children}
          </Content>
          {footer ? (
            <View style={[styles.footer, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border, padding: theme.spacing.lg }]}>
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardScrollContext.Provider>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
