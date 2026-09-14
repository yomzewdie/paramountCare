import { buildStepPatch } from '../stepPatch';
import type { SessionResponse } from '../sessionApi';

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 5,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    stepStates: { personal_info: 'not_started', employment_application: 'in_progress' },
    formData: { employmentApplication: { positionApplied: 'RN' } },
    status: 'active',
    applicationId: null,
    revision: 4,
    completionPercent: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildStepPatch', () => {
  it('sends the session\'s current revision', () => {
    const patch = buildStepPatch({ session: fakeSession({ revision: 7 }), formDataKey: 'personalInfo', stepData: {}, stepId: 'personal_info' });
    expect(patch.revision).toBe(7);
  });

  it('merges the new step data onto the FULL existing formData, never dropping other steps', () => {
    const session = fakeSession();
    const patch = buildStepPatch({ session, formDataKey: 'personalInfo', stepData: { firstName: 'Jane' }, stepId: 'personal_info' });

    expect(patch.formData).toEqual({
      employmentApplication: { positionApplied: 'RN' }, // untouched, still present
      personalInfo: { firstName: 'Jane' },
    });
  });

  it('merges the new step status onto the FULL existing stepStates, never dropping other steps', () => {
    const session = fakeSession();
    const patch = buildStepPatch({ session, formDataKey: 'personalInfo', stepData: {}, stepId: 'personal_info', status: 'completed' });

    expect(patch.stepStates).toEqual({
      employment_application: 'in_progress', // untouched, still present
      personal_info: 'completed',
    });
  });

  it('leaves stepStates completely unchanged when no status is given (a plain partial-data save)', () => {
    const session = fakeSession();
    const patch = buildStepPatch({ session, formDataKey: 'personalInfo', stepData: {}, stepId: 'personal_info' });

    expect(patch.stepStates).toEqual(session.stepStates);
  });

  it('does not mutate the original session object', () => {
    const session = fakeSession();
    const snapshotFormData = { ...session.formData };
    const snapshotStepStates = { ...session.stepStates };

    buildStepPatch({ session, formDataKey: 'personalInfo', stepData: { firstName: 'Jane' }, stepId: 'personal_info', status: 'completed' });

    expect(session.formData).toEqual(snapshotFormData);
    expect(session.stepStates).toEqual(snapshotStepStates);
  });
});
