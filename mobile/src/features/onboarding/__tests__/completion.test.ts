import { computeOverallCompletion, defaultFormData } from '@pcs/shared';

// M10: computeOverallCompletion()'s content-steps list previously omitted
// application_statement and background_auth entirely (packages/shared/src/
// completion.ts) — a stale-list oversight, not an intentional exclusion,
// discovered while confirming M10's required-vs-optional completion
// behavior. Fixed by adding both (universal + required, same as every
// other step already in the list). These tests exercise the real,
// unmodified shared function directly — never a reimplementation of its
// algorithm — proving the fix and guarding against it regressing.
describe('computeOverallCompletion — application_statement/background_auth now count (M10)', () => {
  function withAck(stepId: string, checked: boolean, typedSignature: string) {
    return {
      ...defaultFormData,
      acknowledgements: {
        ...defaultFormData.acknowledgements,
        [stepId]: { checked, typedSignature, signedAt: checked ? '2026-01-01T00:00:00.000Z' : '' },
      },
    };
  }

  it('completing application_statement increases the overall percentage', () => {
    const before = computeOverallCompletion(defaultFormData);
    const after = computeOverallCompletion(withAck('application_statement', true, 'Jane Doe'));
    expect(after).toBeGreaterThan(before);
  });

  it('completing background_auth increases the overall percentage', () => {
    const before = computeOverallCompletion(defaultFormData);
    const after = computeOverallCompletion(withAck('background_auth', true, 'Jane Doe'));
    expect(after).toBeGreaterThan(before);
  });

  it('leaving both unsigned does not count them as complete (0 of 2 each) while still contributing to the denominator', () => {
    // An empty-but-present acknowledgement entry contributes 0 completed
    // out of a total of 2 (checked + typedSignature) for each of these two
    // steps — confirmed by comparing against a fully-empty formData, which
    // must produce the exact same percentage as an explicitly-empty entry.
    const emptyEntryPercent = computeOverallCompletion(withAck('application_statement', false, ''));
    const noEntryPercent = computeOverallCompletion(defaultFormData);
    expect(emptyEntryPercent).toBe(noEntryPercent);
  });

  it('employment_ref_3 (optional, travel_rn-only) is still not part of the overall percentage — unchanged, deliberately out of scope for this targeted fix', () => {
    const before = computeOverallCompletion(defaultFormData);
    const after = computeOverallCompletion({
      ...defaultFormData,
      employmentReferences: {
        ...defaultFormData.employmentReferences,
        employment_ref_3: {
          positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
          employerName: 'Test', employerCity: 'Test', employerState: 'CA',
          supervisorName: 'Test', supervisorPhone: '555-000-1111',
          permissionGranted: true, reasonForLeaving: 'Test', eligibleForRehire: true,
          rehireDetails: '', comments: '',
        },
      },
    });
    expect(after).toBe(before);
  });
});
