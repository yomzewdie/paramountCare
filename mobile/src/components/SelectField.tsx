import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  error?: string;
}

/**
 * A reusable single-choice picker built entirely from React Native's own
 * Modal/FlatList/Pressable — no native picker dependency added just for
 * this one field. Genuinely reusable: future steps have several more
 * fixed-choice fields (shift preference, employment type, filing status,
 * citizenship status) that will want the exact same pattern.
 */
export function SelectField({ label, value, onValueChange, options, placeholder = 'Select…', required, error }: SelectFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text, marginBottom: theme.spacing.xs }]}>
        {label}
        {required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}${required ? ', required' : ''}`}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        style={[
          styles.trigger,
          {
            minHeight: theme.minTouchTarget,
            borderRadius: theme.radii.sm,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Text style={[theme.typography.body, { color: selected ? theme.colors.text : theme.colors.textMuted }]}>
          {selected?.label ?? placeholder}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[theme.typography.caption, { color: theme.colors.danger, marginTop: theme.spacing.xs }]}>
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.lg, borderTopRightRadius: theme.radii.lg, padding: theme.spacing.lg }]}>
          <Text style={[theme.typography.title, { color: theme.colors.text, marginBottom: theme.spacing.md }]}>{label}</Text>
          <FlatList
            data={options}
            keyExtractor={(item) => item.value}
            style={{ maxHeight: 360 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onValueChange(item.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: item.value === value }}
                style={[styles.option, { minHeight: theme.minTouchTarget }]}
              >
                <Text style={[theme.typography.body, { color: theme.colors.text, flex: 1 }]}>{item.label}</Text>
                {item.value === value ? <Text style={{ color: theme.colors.primary }}>✓</Text> : null}
              </Pressable>
            )}
          />
          <View style={{ marginTop: theme.spacing.md }}>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { paddingBottom: 32 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
