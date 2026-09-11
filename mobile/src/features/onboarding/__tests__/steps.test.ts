import { deriveProgress } from '../steps';

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
});
