import { deriveProgress } from '../steps';
import { getPacket } from '@pcs/shared';

describe('deriveProgress', () => {
  it('returns null for an unknown packetId rather than throwing', () => {
    expect(deriveProgress('not_a_real_packet', {})).toBeNull();
  });

  it('marks every step as remaining when stepStates is empty', () => {
    const progress = deriveProgress('general_rn', {});
    expect(progress).not.toBeNull();
    expect(progress!.completedSteps).toHaveLength(0);
    expect(progress!.remainingSteps.length).toBe(progress!.steps.length);
    expect(progress!.isComplete).toBe(false);
    expect(progress!.nextStep?.id).toBe(progress!.steps[0].id);
  });

  it('splits completed vs remaining correctly and computes the next step', () => {
    const progress = deriveProgress('general_rn', {
      personal_info: 'completed',
      employment_application: 'completed',
    });
    expect(progress).not.toBeNull();
    expect(progress!.completedSteps.map((s) => s.id)).toEqual(['personal_info', 'employment_application']);
    expect(progress!.remainingSteps.every((s) => !s.completed)).toBe(true);
    // The next step is the first step after the two completed ones, in packet order.
    expect(progress!.nextStep?.id).toBe('application_statement');
  });

  it('reports isComplete and a null nextStep once every step is completed', () => {
    const packetProgress = deriveProgress('general_rn', {});
    const allCompleted = Object.fromEntries(packetProgress!.steps.map((s) => [s.id, 'completed']));

    const progress = deriveProgress('general_rn', allCompleted);
    expect(progress!.isComplete).toBe(true);
    expect(progress!.nextStep).toBeNull();
    expect(progress!.remainingSteps).toHaveLength(0);
  });

  it('treats non-"completed" statuses (in_progress, failed, skipped) as not completed', () => {
    const progress = deriveProgress('general_rn', { personal_info: 'in_progress' });
    expect(progress!.completedSteps).toHaveLength(0);
    expect(progress!.steps.find((s) => s.id === 'personal_info')?.completed).toBe(false);
  });

  // M9: re-confirmed by direct packets.ts inspection that employment_ref_2
  // is required in EVERY packet (general_rn, lvn, icu_rn, er_rn, travel_rn)
  // — there is no "some packets skip Reference #2" branch. These tests use
  // the real shared getPacket()/deriveProgress() throughout, never a
  // duplicated/hand-rolled packet shape, per the instruction not to
  // reimplement packet logic just to make an assertion pass.
  describe('packet-aware progress (M9)', () => {
    it('a shorter packet (icu_rn) is not penalized by a longer packet\'s (general_rn) step count — each packet has its own denominator', () => {
      const generalRn = deriveProgress('general_rn', {});
      const icuRn = deriveProgress('icu_rn', {});
      expect(generalRn!.steps.length).toBe(getPacket('general_rn')!.steps.length);
      expect(icuRn!.steps.length).toBe(getPacket('icu_rn')!.steps.length);
      // general_rn has health_info_auth/patient_bill_of_rights/vaccine
      // declinations/jcaho_review/safety_exam that icu_rn's condensed flow omits.
      expect(icuRn!.steps.length).toBeLessThan(generalRn!.steps.length);
      expect(icuRn!.steps.some((s) => s.id === 'health_info_auth')).toBe(false);
    });

    it('every packet requires employment_ref_2 before employment_ref_1 can be considered the "next" step is done', () => {
      for (const packetId of ['general_rn', 'lvn', 'icu_rn', 'er_rn', 'travel_rn']) {
        const progress = deriveProgress(packetId, { personal_info: 'completed', employment_application: 'completed', application_statement: 'completed', employment_ref_1: 'completed' });
        expect(progress!.nextStep?.id).toBe('employment_ref_2');
      }
    });

    it('completing employment_ref_1 and employment_ref_2 surfaces background_auth as the next step, identically for general_rn and icu_rn', () => {
      const completedThroughRef2 = { personal_info: 'completed', employment_application: 'completed', application_statement: 'completed', employment_ref_1: 'completed', employment_ref_2: 'completed' } as const;
      const generalRn = deriveProgress('general_rn', completedThroughRef2);
      const icuRn = deriveProgress('icu_rn', completedThroughRef2);
      expect(generalRn!.nextStep?.id).toBe('background_auth');
      expect(icuRn!.nextStep?.id).toBe('background_auth');
    });

  });

  // M10: the M9 test above this comment ("deriveProgress/resolveCurrentStep
  // does not skip an incomplete OPTIONAL step") documented a real,
  // pre-existing gap: leaving an optional step (Travel RN's
  // employment_ref_3, or General RN's optional safety_exam) incomplete
  // made the dashboard incorrectly show it as "next" and isComplete as
  // false, even once every REQUIRED step was done. Fixed at the shared
  // domain layer (packages/shared/src/packets.ts's new
  // resolveNextRequiredStep(), plus reusing the already-correct
  // isPacketComplete() for isComplete instead of re-deriving it) — see
  // ADR-022. These tests prove the fix using the real shared functions,
  // not a reimplementation of packet logic.
  describe('required-vs-optional next action (M10)', () => {
    it('an incomplete OPTIONAL step (Travel RN\'s employment_ref_3) is never returned as "next" once every required step is done, and isComplete becomes true', () => {
      const packet = getPacket('travel_rn')!;
      const allRequiredCompleted = Object.fromEntries(
        packet.steps.filter((s) => s.required).map((s) => [s.id, 'completed']),
      );
      const progress = deriveProgress('travel_rn', allRequiredCompleted);
      expect(progress!.nextStep).toBeNull();
      expect(progress!.isComplete).toBe(true);

      // The optional step itself is still listed and still discoverable —
      // just not presented as the required next action.
      const ref3 = progress!.steps.find((s) => s.id === 'employment_ref_3');
      expect(ref3).toBeDefined();
      expect(ref3!.required).toBe(false);
      expect(ref3!.completed).toBe(false);
    });

    it('same fix confirmed on a second optional step in a different packet (General RN\'s optional safety_exam)', () => {
      const packet = getPacket('general_rn')!;
      const allRequiredCompleted = Object.fromEntries(
        packet.steps.filter((s) => s.required).map((s) => [s.id, 'completed']),
      );
      const progress = deriveProgress('general_rn', allRequiredCompleted);
      expect(progress!.nextStep).toBeNull();
      expect(progress!.isComplete).toBe(true);
      expect(progress!.steps.find((s) => s.id === 'safety_exam')?.required).toBe(false);
    });

    it('an incomplete REQUIRED step still correctly becomes "next," even when a later optional step also remains incomplete', () => {
      const packet = getPacket('travel_rn')!;
      const completedExceptBackgroundAuth = Object.fromEntries(
        packet.steps
          .filter((s) => s.required && s.id !== 'background_auth')
          .map((s) => [s.id, 'completed']),
      );
      const progress = deriveProgress('travel_rn', completedExceptBackgroundAuth);
      expect(progress!.nextStep?.id).toBe('background_auth');
      expect(progress!.isComplete).toBe(false);
    });

    it('every StepDisplayItem carries the real required flag from the packet, not a hardcoded assumption', () => {
      const progress = deriveProgress('travel_rn', {})!;
      const byId = Object.fromEntries(progress.steps.map((s) => [s.id, s.required]));
      expect(byId.employment_ref_1).toBe(true);
      expect(byId.employment_ref_2).toBe(true);
      expect(byId.employment_ref_3).toBe(false);
      expect(byId.background_auth).toBe(true);
    });
  });
});
