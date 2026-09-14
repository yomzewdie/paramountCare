import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface FormSectionProps {
  title: string;
  children: ReactNode;
}

/** Groups related fields under a small caption heading — e.g. "Legal Name,"
 * "Contact Information," "Home Address" (mirroring the existing web form's
 * grouping, not inventing a new structure). Reusable for every future
 * multi-section step form. */
export function FormSection({ title, children }: FormSectionProps) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text
        style={[
          theme.typography.caption,
          { color: theme.colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: theme.spacing.sm },
        ]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 8 },
});
