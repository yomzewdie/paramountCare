import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';
import PersonalInfoScreen from '../../../src/features/onboarding/PersonalInfoScreen';

// A real form for a migrated step, an honest placeholder for everything
// else — one small registry, so slotting in the next migrated step (M6+)
// means adding one entry here, not restructuring how a step is reached
// (M5 instructions §11, §14/M4's own note about this route's purpose).
const REAL_STEP_SCREENS: Partial<Record<string, React.ComponentType>> = {
  personal_info: PersonalInfoScreen,
};

export default function OnboardingStep() {
  const theme = useTheme();
  const router = useRouter();
  const { progress } = useSession();
  const { stepId } = useLocalSearchParams<{ stepId: string }>();

  const RealScreen = stepId ? REAL_STEP_SCREENS[stepId] : undefined;
  if (RealScreen) return <RealScreen />;

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
