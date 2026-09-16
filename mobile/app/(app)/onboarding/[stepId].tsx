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
import I9Screen from '../../../src/features/onboarding/I9Screen';
import VaccineDeclinationScreen from '../../../src/features/onboarding/VaccineDeclinationScreen';
import DirectDepositScreen from '../../../src/features/onboarding/DirectDepositScreen';
import DocumentsScreen from '../../../src/features/onboarding/DocumentsScreen';
import SafetyAcknowledgementsScreen from '../../../src/features/onboarding/SafetyAcknowledgementsScreen';

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
// patient_bill_of_rights (M12) is a fifth real example reusing
// AcknowledgementScreen — identical model, independently re-confirmed.
// i9 (M12) is ICU/ER/Travel's next step after w4, Section 1 only —
// Section 2 (employer/document verification) is Paramount staff's
// responsibility and is deliberately not represented anywhere in this
// app. See ADR-024.
// hep_b_declination (M13) is General RN/LVN's next step after i9 — the
// first required vaccine declination step. VaccineDeclinationScreen is
// stepId-generic (same reasoning as EmploymentReferenceScreen/
// AcknowledgementScreen) so tdap_declination/flu_declination need only a
// registry entry, not new code, once their own metadata is confirmed and
// added to VaccineDeclinationScreen's VACCINE_META. Only hep_b_declination
// is wired in here per "earliest missing step only." See ADR-025.
// direct_deposit (M13) is ICU/ER/Travel's next step after i9 — sourced
// directly from Paramount's real Direct Deposit Authorization form (not
// left as the prior "coming soon" placeholder). Its own next step
// (`documents`) remains an honest placeholder — it has no mobile
// implementation yet and is out of scope for this milestone. See ADR-025.
// tdap_declination (M14) is General RN/LVN's next step after
// hep_b_declination — confirmed structurally identical to it (same
// decision values, same declining/proof-upload behavior, only the copy
// differs), so it reuses VaccineDeclinationScreen with zero new code, per
// the exact reuse-readiness this registry's own hep_b_declination comment
// already anticipated. flu_declination was confirmed and wired in M15 —
// see its own comment below. See ADR-027.
// documents (M14) is ICU/ER/Travel's next step after direct_deposit — the
// real "License & Credential Uploads" checklist (I-9 identity, nursing
// license, CPR/BLS certification), sourced from packets.ts's own
// `i9Uploads`/`requiredUploads` config and the existing web
// UploadSection.tsx's document catalog, not invented. General RN/LVN also
// have this exact step later in their own sequence (after the three
// vaccine declinations + W-4 + I-9) — this one registry entry, keyed by
// step id, correctly serves both branches once each reaches it, the same
// way direct_deposit already does. See ADR-027.
// flu_declination (M15) is General RN/LVN's next step after
// tdap_declination — directly compared (not assumed) against both hep_b
// and tdap and confirmed identical in every structural respect (decision
// values, declining/proof-upload behavior, requiresSignature), differing
// only in copy already added to VaccineDeclinationScreen's VACCINE_META.
// No new component or hook needed, same as tdap's own reuse. See ADR-028.
// safety_acknowledgements (M15) is ICU/ER/Travel's next step after
// documents, AND General RN/LVN's own later step after their own
// jcaho_review (unimplemented, out of scope). One registry entry, keyed by
// step id, correctly serves both branches once each reaches it — same
// pattern as direct_deposit/documents above. Deliberately NOT built on
// AcknowledgementScreen/useAcknowledgementForm: the real source model
// (frontend/components/onboarding/SafetySection.tsx) is 8 independent
// topic checkboxes plus one final attestation checkbox, with no typed
// signature anywhere — a genuinely different shape, not a relabeled
// AcknowledgementEntry. Its own already-existing shared validator
// (validateSafety) and data shape (SafetyEducationData) required zero
// shared-package changes. The optional safety_exam step (General RN/LVN
// only, required: false) remains unimplemented and never blocks packet
// completion — resolveNextRequiredStep already filters it out. See
// ADR-028.
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
  patient_bill_of_rights: AcknowledgementScreen,
  i9: I9Screen,
  hep_b_declination: VaccineDeclinationScreen,
  tdap_declination: VaccineDeclinationScreen,
  flu_declination: VaccineDeclinationScreen,
  direct_deposit: DirectDepositScreen,
  documents: DocumentsScreen,
  safety_acknowledgements: SafetyAcknowledgementsScreen,
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
