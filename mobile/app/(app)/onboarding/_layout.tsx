import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme/ThemeProvider';

// Unlike the auth flow's headerless stack (each of those screens has its own
// in-content navigation), this is a genuine drill-down — a native header
// with a back button is the right pattern here, not a design inconsistency.
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
