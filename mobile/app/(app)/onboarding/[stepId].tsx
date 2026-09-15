import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/StatusStates';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { useSession } from '../../../src/features/onboarding/SessionContext';
import PersonalInfoScreen from '../../../src/features/onboarding/PersonalInfoScreen';
import EmploymentApplicationScreen from '../../../src/features/onboarding/EmploymentApplicationScreen';
import AcknowledgementScreen from '../../../src/features/onboarding/AcknowledgementScreen';
import EmploymentReferenceScreen from '../../../src/features/onboarding/EmploymentReferenceScreen';
import W4Screen from '../../../src/features/onboarding/W4Screen';

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
// employment_ref_1, employment_ref_2, AND employment_ref_3 share the exact
// same screen — EmploymentReferenceScreen was written stepId-generic in M6
// specifically so any reference instance needs no new component, only a
// registry entry. employment_ref_3 exists only in travel_rn and is
// OPTIONAL (packets.ts) — being wired in here does not make it the
// applicant's primary "next required action" (see steps.ts's
// resolveNextRequiredStep(), M10 / ADR-022); it just means the applicant
// can open and complete it if they choose to.
// application_statement, background_auth, AND health_info_auth share
// AcknowledgementScreen — generalized in M10 from M8's step-specific
// ApplicationStatementScreen once a second real example (Background
// Authorization) proved they were genuinely identical except
// stepId/heading/legal text; health_info_auth (M11) was independently
// re-confirmed against source to share the exact same model before being
// added here (ADR-022's own instruction: every new acknowledgement step
// needs its own confirmation, not an assumption from the name). See
// ADR-023 for M11's findings.
// w4 (M11) is General RN/LVN's and ICU/ER/Travel's first genuinely
// branch-diverging next step — health_info_auth exists only in
// general_rn/lvn, w4 is reached directly after background_auth for
// icu_rn/er_rn/travel_rn. Both entries below are correct simultaneously;
// which one an applicant actually reaches is entirely determined by their
// own packet (packets.ts), never by a mobile-side role check.
// Exported (not just used locally) so the registry mapping itself is
// directly unit-testable without a full screen render — see
// __tests__/stepId.test.ts.
export const REAL_STEP_SCREENS: Partial<Record<string, React.ComponentType>> = {
  personal_info: PersonalInfoScreen,
  employment_application: EmploymentApplicationScreen,
  application_statement: AcknowledgementScreen,
  employment_ref_1: EmploymentReferenceScreen,
  employment_ref_2: EmploymentReferenceScreen,
  employment_ref_3: EmploymentReferenceScreen,
  background_auth: AcknowledgementScreen,
  health_info_auth: AcknowledgementScreen,
  w4: W4Screen,
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
