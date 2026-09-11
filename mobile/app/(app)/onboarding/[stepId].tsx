import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';

// Deliberately a placeholder for every step — no onboarding forms are
// migrated in M4 (instructions §27). This route exists so the navigation
// architecture is real and future milestones can replace this file's
// content per step without restructuring how a step is reached.
export default function OnboardingStep() {
  const theme = useTheme();
  const router = useRouter();
  const { progress } = useSession();
  const { stepId } = useLocalSearchParams<{ stepId: string }>();

  const step = progress?.steps.find((s) => s.id === stepId);

  return (
    <Screen>
      <EmptyState
        title={step?.label ?? 'This step'}
        message="This step will be available in an upcoming mobile release. Please check back soon."
      />
      <View style={{ marginTop: theme.spacing.lg }}>
        <Button label="Back to Onboarding" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
