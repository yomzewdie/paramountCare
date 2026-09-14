import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from 'expo-router';

/**
 * Warns before leaving a screen with unsaved changes — back button, swipe
 * gesture, or in-content navigation all go through the same React
 * Navigation `beforeRemove` event, so one hook covers all three. Kept
 * simple and predictable (M5 instructions §13): a native confirm dialog,
 * "keep editing" or "discard" — never a silent auto-save, never a trap the
 * applicant can't get out of (the dialog always offers a way to actually
 * leave).
 */
export function useUnsavedChangesGuard(isDirty: boolean, onDiscard?: () => void): void {
  const navigation = useNavigation();

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'You have unsaved changes. If you leave now, they will be lost.', [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            onDiscard?.();
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, isDirty, onDiscard]);
}
