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

    it('deriveProgress/resolveCurrentStep does not skip an incomplete OPTIONAL step (employment_ref_3) — a pre-existing, unchanged characteristic, not something M9 introduces or changes', () => {
      // isPacketComplete() (packets.ts) DOES filter by required and would
      // correctly report this applicant as done; deriveProgress()'s
      // isComplete/nextStep instead reuse resolveCurrentStep(), which finds
      // the first NON-COMPLETED step regardless of required. Documenting
      // this distinction directly rather than asserting a "the dashboard
      // is required-aware" behavior that resolveCurrentStep doesn't
      // actually implement.
      const packet = getPacket('travel_rn')!;
      const allRequiredCompleted = Object.fromEntries(
        packet.steps.filter((s) => s.required).map((s) => [s.id, 'completed']),
      );
      const progress = deriveProgress('travel_rn', allRequiredCompleted);
      expect(progress!.nextStep?.id).toBe('employment_ref_3');
      expect(progress!.isComplete).toBe(false);

      // Completing the optional step too does resolve it, confirming this
      // is purely about required-awareness, not a broader defect.
      const everythingCompleted = Object.fromEntries(packet.steps.map((s) => [s.id, 'completed']));
      expect(deriveProgress('travel_rn', everythingCompleted)!.isComplete).toBe(true);
    });
  });
});
