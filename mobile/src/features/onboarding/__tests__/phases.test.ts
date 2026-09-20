import { getPacket, type StepStatus } from '@pcs/shared';
import { deriveProgress } from '../steps';
import {
  ONBOARDING_PHASES,
  groupStepsIntoPhases,
  derivePhaseRequiredCounts,
  derivePhaseStatus,
  findCurrentPhaseId,
  type OnboardingPhaseId,
} from '../phases';

const PACKET_IDS = ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn'];

describe('groupStepsIntoPhases', () => {
  it('produces exactly four groups, in the fixed applicant-facing order, for every packet', () => {
    for (const packetId of PACKET_IDS) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      expect(groups.map((g) => g.id)).toEqual(['about_you', 'authorizations', 'pay_health_documents', 'safety_review']);
    }
  });

  it('never loses a step: the union of every phase\'s steps equals the original packet steps, for every packet', () => {
    for (const packetId of PACKET_IDS) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      const grouped = groups.flatMap((g) => g.steps.map((s) => s.id));
      expect(grouped.sort()).toEqual(progress.steps.map((s) => s.id).sort());
    }
  });

  it('never duplicates a step across phases: every step ID appears in exactly one phase, for every packet', () => {
    for (const packetId of PACKET_IDS) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      const seen = new Set<string>();
      for (const group of groups) {
        for (const step of group.steps) {
          expect(seen.has(step.id)).toBe(false);
          seen.add(step.id);
        }
      }
      expect(seen.size).toBe(progress.steps.length);
    }
  });

  it('preserves the real packet order within each phase, for every packet', () => {
    for (const packetId of PACKET_IDS) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      for (const group of groups) {
        const idsInPhase = group.steps.map((s) => s.id);
        const idsInPacketOrder = progress.steps.filter((s) => idsInPhase.includes(s.id)).map((s) => s.id);
        expect(idsInPhase).toEqual(idsInPacketOrder);
      }
    }
  });

  it('keeps each phase a genuinely CONTIGUOUS slice of the real packet order, for every packet (no reordering required to form the four groups)', () => {
    for (const packetId of PACKET_IDS) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      const phaseIndexById = new Map<OnboardingPhaseId, number>(ONBOARDING_PHASES.map((p, i) => [p.id, i]));
      const sequence = progress.steps.map((s) => {
        const owningPhase = groups.find((g) => g.steps.some((gs) => gs.id === s.id))!;
        return phaseIndexById.get(owningPhase.id)!;
      });
      // A contiguous grouping means the phase-index sequence walking the
      // real packet order never decreases (1,1,1,2,2,3,3,3,3,4,4 — never
      // 1,2,1).
      for (let i = 1; i < sequence.length; i++) {
        expect(sequence[i]).toBeGreaterThanOrEqual(sequence[i - 1]);
      }
    }
  });

  it('throws rather than silently dropping a step with no configured phase', () => {
    expect(() => groupStepsIntoPhases([{ id: 'not_a_real_step', label: 'X', completed: false, required: true }])).toThrow(
      /has no configured onboarding phase/,
    );
  });

  describe('General RN / LVN — final four-group mapping (19 steps)', () => {
    it('matches the exact discovered contiguous mapping', () => {
      const progress = deriveProgress('general_rn', {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      expect(groups.find((g) => g.id === 'about_you')!.steps.map((s) => s.id)).toEqual([
        'personal_info', 'employment_application', 'application_statement', 'employment_ref_1', 'employment_ref_2',
      ]);
      expect(groups.find((g) => g.id === 'authorizations')!.steps.map((s) => s.id)).toEqual([
        'background_auth', 'health_info_auth', 'patient_bill_of_rights',
      ]);
      expect(groups.find((g) => g.id === 'pay_health_documents')!.steps.map((s) => s.id)).toEqual([
        'hep_b_declination', 'tdap_declination', 'flu_declination', 'w4', 'i9', 'direct_deposit', 'documents',
      ]);
      expect(groups.find((g) => g.id === 'safety_review')!.steps.map((s) => s.id)).toEqual([
        'jcaho_review', 'safety_acknowledgements', 'safety_exam', 'review',
      ]);
    });

    it('lvn produces the identical mapping to general_rn (same underlying step list)', () => {
      const generalGroups = groupStepsIntoPhases(deriveProgress('general_rn', {})!.steps);
      const lvnGroups = groupStepsIntoPhases(deriveProgress('lvn', {})!.steps);
      expect(lvnGroups.map((g) => g.steps.map((s) => s.id))).toEqual(generalGroups.map((g) => g.steps.map((s) => s.id)));
    });
  });

  describe('ICU/ER RN — condensed 12-step mapping (no health_info_auth/patient_bill_of_rights/vaccines/jcaho/exam)', () => {
    it('matches the exact discovered contiguous mapping', () => {
      for (const packetId of ['icu_rn', 'er_rn']) {
        const progress = deriveProgress(packetId, {})!;
        const groups = groupStepsIntoPhases(progress.steps);
        expect(groups.find((g) => g.id === 'about_you')!.steps.map((s) => s.id)).toEqual([
          'personal_info', 'employment_application', 'application_statement', 'employment_ref_1', 'employment_ref_2',
        ]);
        expect(groups.find((g) => g.id === 'authorizations')!.steps.map((s) => s.id)).toEqual(['background_auth']);
        expect(groups.find((g) => g.id === 'pay_health_documents')!.steps.map((s) => s.id)).toEqual([
          'w4', 'i9', 'direct_deposit', 'documents',
        ]);
        expect(groups.find((g) => g.id === 'safety_review')!.steps.map((s) => s.id)).toEqual([
          'safety_acknowledgements', 'review',
        ]);
      }
    });
  });

  describe('Travel RN — 13-step mapping with optional Employment Reference #3', () => {
    it('places the optional employment_ref_3 in About You & Work History, immediately after Reference #2, still marked optional', () => {
      const progress = deriveProgress('travel_rn', {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      const aboutYou = groups.find((g) => g.id === 'about_you')!;
      expect(aboutYou.steps.map((s) => s.id)).toEqual([
        'personal_info', 'employment_application', 'application_statement', 'employment_ref_1', 'employment_ref_2', 'employment_ref_3',
      ]);
      const ref3 = aboutYou.steps.find((s) => s.id === 'employment_ref_3')!;
      expect(ref3.required).toBe(false);
    });

    it('otherwise matches the same condensed mapping as icu_rn/er_rn for the remaining phases', () => {
      const progress = deriveProgress('travel_rn', {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      expect(groups.find((g) => g.id === 'authorizations')!.steps.map((s) => s.id)).toEqual(['background_auth']);
      expect(groups.find((g) => g.id === 'pay_health_documents')!.steps.map((s) => s.id)).toEqual([
        'w4', 'i9', 'direct_deposit', 'documents',
      ]);
      expect(groups.find((g) => g.id === 'safety_review')!.steps.map((s) => s.id)).toEqual([
        'safety_acknowledgements', 'review',
      ]);
    });
  });

  it('confirms the optional Clinical Competency Exam (safety_exam) sits in Safety & Final Review, marked optional, only for general_rn/lvn', () => {
    for (const packetId of ['general_rn', 'lvn']) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      const exam = groups.find((g) => g.id === 'safety_review')!.steps.find((s) => s.id === 'safety_exam');
      expect(exam).toBeDefined();
      expect(exam!.required).toBe(false);
    }
    for (const packetId of ['icu_rn', 'er_rn', 'travel_rn']) {
      const progress = deriveProgress(packetId, {})!;
      const groups = groupStepsIntoPhases(progress.steps);
      expect(groups.find((g) => g.id === 'safety_review')!.steps.some((s) => s.id === 'safety_exam')).toBe(false);
    }
  });
});

describe('derivePhaseRequiredCounts', () => {
  it('counts only required steps — an incomplete optional step never appears in either number', () => {
    const progress = deriveProgress('travel_rn', {
      personal_info: 'completed', employment_application: 'completed', application_statement: 'completed',
      employment_ref_1: 'completed', employment_ref_2: 'completed',
      // employment_ref_3 (optional) deliberately left not_started
    })!;
    const aboutYou = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'about_you')!;
    const counts = derivePhaseRequiredCounts(aboutYou.steps);
    expect(counts.totalRequired).toBe(5); // excludes employment_ref_3
    expect(counts.completedRequired).toBe(5);
  });
});

describe('derivePhaseStatus', () => {
  it('is "not_started" when nothing in the phase has any recorded activity', () => {
    const progress = deriveProgress('general_rn', {})!;
    const group = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'pay_health_documents')!;
    expect(derivePhaseStatus(group.steps, {})).toBe('not_started');
  });

  it('is "in_progress" once at least one step has activity but required work remains', () => {
    const progress = deriveProgress('general_rn', { w4: 'in_progress' })!;
    const group = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'pay_health_documents')!;
    expect(derivePhaseStatus(group.steps, { w4: 'in_progress' })).toBe('in_progress');
  });

  it('is "completed" once every REQUIRED step in the phase is completed, even if raw activity data is incomplete/missing', () => {
    const packet = getPacket('general_rn')!;
    const phaseStepIds = ['hep_b_declination', 'tdap_declination', 'flu_declination', 'w4', 'i9', 'direct_deposit', 'documents'];
    const allCompleted = Object.fromEntries(phaseStepIds.map((id) => [id, 'completed']));
    const progress = deriveProgress('general_rn', allCompleted)!;
    const group = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'pay_health_documents')!;
    expect(group.steps.map((s) => s.id).sort()).toEqual(packet.steps.filter((s) => phaseStepIds.includes(s.id)).map((s) => s.id).sort());
    expect(derivePhaseStatus(group.steps, allCompleted as Partial<Record<string, StepStatus>>)).toBe('completed');
  });

  it('required completion is unaffected by an incomplete optional step in the same phase (Safety & Final Review, general_rn)', () => {
    const requiredIdsInPhase = ['jcaho_review', 'safety_acknowledgements', 'review'];
    const allCompleted = Object.fromEntries(requiredIdsInPhase.map((id) => [id, 'completed']));
    // safety_exam (optional) deliberately left out of stepStates entirely.
    const progress = deriveProgress('general_rn', allCompleted)!;
    const group = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'safety_review')!;
    expect(derivePhaseStatus(group.steps, allCompleted as Partial<Record<string, StepStatus>>)).toBe('completed');
  });

  it('a phase with a completed optional step but no required activity yet is still "in_progress", not "completed" or "not_started"', () => {
    const progress = deriveProgress('travel_rn', { employment_ref_3: 'completed' })!;
    const group = groupStepsIntoPhases(progress.steps).find((g) => g.id === 'about_you')!;
    expect(derivePhaseStatus(group.steps, { employment_ref_3: 'completed' })).toBe('in_progress');
  });
});

describe('findCurrentPhaseId', () => {
  it('returns the phase containing the authoritative progress.nextStep', () => {
    const progress = deriveProgress('general_rn', {
      personal_info: 'completed', employment_application: 'completed', application_statement: 'completed',
      employment_ref_1: 'completed', employment_ref_2: 'completed',
    })!;
    expect(progress.nextStep?.id).toBe('background_auth');
    const groups = groupStepsIntoPhases(progress.steps);
    expect(findCurrentPhaseId(groups, progress.nextStep?.id)).toBe('authorizations');
  });

  it('returns null once progress.nextStep itself is null (every required step complete)', () => {
    const packet = getPacket('general_rn')!;
    const allRequiredCompleted = Object.fromEntries(packet.steps.filter((s) => s.required).map((s) => [s.id, 'completed']));
    const progress = deriveProgress('general_rn', allRequiredCompleted)!;
    expect(progress.nextStep).toBeNull();
    const groups = groupStepsIntoPhases(progress.steps);
    expect(findCurrentPhaseId(groups, progress.nextStep?.id)).toBeNull();
  });

  it('tracks the current phase moving forward across phase boundaries as steps complete', () => {
    const packet = getPacket('icu_rn')!;
    const upToAndIncludingDocuments = Object.fromEntries(
      packet.steps.filter((s) => packet.steps.findIndex((x) => x.id === s.id) <= packet.steps.findIndex((x) => x.id === 'documents')).map((s) => [s.id, 'completed']),
    );
    const progress = deriveProgress('icu_rn', upToAndIncludingDocuments)!;
    expect(progress.nextStep?.id).toBe('safety_acknowledgements');
    const groups = groupStepsIntoPhases(progress.steps);
    expect(findCurrentPhaseId(groups, progress.nextStep?.id)).toBe('safety_review');
  });
});
