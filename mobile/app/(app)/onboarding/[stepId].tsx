import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';
import PersonalInfoScreen from '../../../src/features/onboarding/PersonalInfoScreen';
import EmploymentApplicationScreen from '../../../src/features/onboarding/EmploymentApplicationScreen';
import ApplicationStatementScreen from '../../../src/features/onboarding/ApplicationStatementScreen';
import EmploymentReferenceScreen from '../../../src/features/onboarding/EmploymentReferenceScreen';

// A real form for a migrated step, an honest placeholder for everything
// else — one small registry, so slotting in the next migrated step means
// adding one entry here, not restructuring how a step is reached (M5
// instructions §11, §14/M4's own note about this route's purpose). This
// registry is keyed by step id only — the applicant-facing ORDER a step
// appears in is entirely derived from packet.steps (see steps.ts /
// onboarding/index.tsx), never from this map or from implementation
// history, so employment_ref_1 (built in M6) correctly stays in its real
// packet position even though its real predecessor, employment_application,
// wasn't migrated until M7.
// Only employment_ref_1 is wired for its step type, even though
// EmploymentReferenceScreen itself is written generically (it derives its
// heading/step id from the route param) — employment_ref_2/_3 stay honest
// placeholders until a future milestone explicitly migrates them too, per
// the "no fake forms" instruction.
// Exported (not just used locally) so the registry mapping itself is
// directly unit-testable without a full screen render — see
// __tests__/stepId.test.ts.
export const REAL_STEP_SCREENS: Partial<Record<string, React.ComponentType>> = {
  personal_info: PersonalInfoScreen,
  employment_application: EmploymentApplicationScreen,
  application_statement: ApplicationStatementScreen,
  employment_ref_1: EmploymentReferenceScreen,
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
