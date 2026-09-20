import { forwardRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
  /** Rendered OUTSIDE the scrollable area, pinned to the bottom of the
   * screen — for a screen's primary action(s) (StepActionBar, a lone
   * Submit button). Stays reachable on a long form without scrolling all
   * the way down, and stays keyboard-/safe-area-aware for free: it's a
   * sibling of the scrollable content inside the SAME
   * SafeAreaView/KeyboardAvoidingView, not a separately-positioned overlay,
   * so the existing iOS keyboard-padding behavior pushes it (and the
   * shrunken scroll area above it) up together, exactly as it already did
   * for a screen with no footer at all. */
  footer?: ReactNode;
}

/** Base layout for every screen: safe-area aware, keyboard-avoiding (forms
 * are the majority of this app's screens), theme background. Ref-forwarded
 * (to the underlying ScrollView when `scroll` is true, a plain View
 * otherwise) so form screens can scroll to an invalid field on failed
 * validation without duplicating this layout. */
export const Screen = forwardRef<ScrollView | View, ScreenProps>(function Screen(
  { children, style, scroll = true, footer, ...rest },
  ref,
) {
  const theme = useTheme();
  const Content = scroll ? ScrollView : View;
  const contentProps = scroll
    ? { contentContainerStyle: [styles.content, { padding: theme.spacing.lg }], keyboardShouldPersistTaps: 'handled' as const }
    : { style: [styles.content, { padding: theme.spacing.lg }] };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Content ref={ref as never} {...contentProps} {...rest} style={[!scroll && contentProps.style, style]}>
          {children}
        </Content>
        {footer ? (
          <View style={[styles.footer, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border, padding: theme.spacing.lg }]}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
});
