import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

interface ScreenProps extends ViewProps {
  scroll?: boolean;
}

/** Base layout for every screen: safe-area aware, keyboard-avoiding (forms
 * are the majority of this app's screens), theme background. */
export function Screen({ children, style, scroll = true, ...rest }: ScreenProps) {
  const theme = useTheme();
  const Content = scroll ? ScrollView : View;
  const contentProps = scroll
    ? { contentContainerStyle: [styles.content, { padding: theme.spacing.lg }], keyboardShouldPersistTaps: 'handled' as const }
    : { style: [styles.content, { padding: theme.spacing.lg }] };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Content {...contentProps} {...rest} style={[!scroll && contentProps.style, style]}>
          {children}
        </Content>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1 },
});
