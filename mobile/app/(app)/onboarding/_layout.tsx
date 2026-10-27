import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme/ThemeProvider';

// Unlike the auth flow's headerless stack (each of those screens has its own
// in-content navigation), this is a genuine drill-down — a native header
// with a back button is the right pattern here, not a design inconsistency.
// The Onboarding list is always the root of this stack, even when a step is
// opened directly from Home or Review — so leaving a step (see
// src/features/onboarding/stepNavigation.ts) can always clear the stack back
// to it, and a previously opened step is never left sitting underneath the
// next one.
export const unstable_settings = { initialRouteName: 'index' };

export default function OnboardingLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Onboarding' }} />
      <Stack.Screen name="[stepId]" options={{ title: '' }} />
    </Stack>
  );
}
