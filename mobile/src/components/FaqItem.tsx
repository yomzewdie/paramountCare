import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface FaqItemProps {
  question: string;
  answer: string;
}

/** One collapsible FAQ row — collapsed by default, independent of every
 * other row (a simple implementation over a coordinated single-open
 * accordion group, per the Help screen's own "simple implementation
 * preferred" direction). The chevron (⌄ expanded / › collapsed, matching
 * OnboardingPhaseHeader's own convention) is a supplementary visual cue
 * only — the actual state is exposed via accessibilityState.expanded, and
 * the answer's own presence/absence in the layout is the primary signal,
 * so nothing here depends on chevron direction or color alone. */
export function FaqItem({ question, answer }: FaqItemProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[styles.container, { borderBottomColor: theme.colors.border }]}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityState={{ expanded }}
        hitSlop={4}
        style={({ pressed }) => [styles.row, { minHeight: theme.minTouchTarget, opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, flex: 1 }]}>{question}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.chevron, { color: theme.colors.textMuted }]}>
          {expanded ? '⌄' : '›'}
        </Text>
      </Pressable>
      {expanded ? (
        <Text style={[theme.typography.body, { color: theme.colors.textMuted, paddingBottom: theme.spacing.md }]}>{answer}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  chevron: { fontSize: 18, marginLeft: 8 },
});
