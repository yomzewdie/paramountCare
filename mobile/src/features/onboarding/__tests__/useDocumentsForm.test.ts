import { renderHook, act } from '@testing-library/react-native';
import { useDocumentsForm } from '../useDocumentsForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

jest.mock('../uploadApi', () => ({
  uploadFile: jest.fn(),
  deleteUpload: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: jest.fn() },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })),
}));

const mockedUseSession = useSession as jest.Mock;

const VALID_UPLOAD = { name: 'file.pdf', size: 100, type: 'application/pdf', objectKey: 'uploads/1/x.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' };

function fakeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 'sess-1',
    packetId: 'general_rn',
    packetVersion: 5,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    stepStates: {},
    formData: {},
    status: 'active',
    applicationId: null,
    revision: 1,
    completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SessionResponse;
}

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock, removeDocumentImpl?: jest.Mock, associateDocumentImpl?: jest.Mock) {
  const saveStep = saveStepImpl ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  const associateDocument = associateDocumentImpl ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  const removeDocument = removeDocumentImpl ?? jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
  mockedUseSession.mockReturnValue({ session, saveStep, associateDocument, removeDocument, status: 'ready', progress: null, error: null, refresh: jest.fn() });
  return { saveStep, associateDocument, removeDocument };
}

beforeEach(() => jest.clearAllMocks());

describe('useDocumentsForm', () => {
  describe('required document set (sourced from packets.ts, not hardcoded)', () => {
    it('resolves the real required set: I-9 identity (3 slots) + nursing license + CPR cert, for general_rn', () => {
      setupSession(fakeSession({ packetId: 'general_rn' }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.visibleIdentitySlots.map((s) => s.docType)).toEqual(['list_a', 'list_b', 'list_c']);
      expect(result.current.visibleCredentialSlots.map((s) => s.docType).sort()).toEqual(['cpr_cert', 'nursing_license']);
    });

    it('resolves the identical required set for icu_rn — no packet/role difference exists in the current source', () => {
      setupSession(fakeSession({ packetId: 'icu_rn' }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.visibleIdentitySlots.map((s) => s.docType)).toEqual(['list_a', 'list_b', 'list_c']);
      expect(result.current.visibleCredentialSlots.map((s) => s.docType).sort()).toEqual(['cpr_cert', 'nursing_license']);
    });

    it('has no optional document slots today — none exist in the real business process, confirmed rather than invented', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDocumentsForm());
      const allVisible = [...result.current.visibleIdentitySlots, ...result.current.visibleCredentialSlots];
      expect(allVisible.every((s) => !s.optional)).toBe(true);
    });
  });

  describe('completion / validation', () => {
    it('shows no errors before Continue is attempted, even though nothing is uploaded', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.errors).toEqual({});
    });

    it('complete() blocks and reveals every missing-required-document error when nothing is uploaded', async () => {
      const { saveStep } = setupSession(fakeSession());
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.i9).toBeTruthy();
      expect(result.current.errors.nursingLicense).toBeTruthy();
      expect(result.current.errors.cprCertification).toBeTruthy();
    });

    it('identity requirement is satisfied by List A alone — List B/C stay unnecessary', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: VALID_UPLOAD, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(result.current.identitySatisfied).toBe(true);
    });

    it('identity requirement is satisfied by List B + List C together, without List A', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: null, listB: VALID_UPLOAD, listC: VALID_UPLOAD, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
    });

    it('List B alone, without List C, does NOT satisfy the identity requirement', () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: null, listB: VALID_UPLOAD, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.identitySatisfied).toBe(false);
    });

    it('List C alone, without List B, does NOT satisfy the identity requirement', () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: null, listB: null, listC: VALID_UPLOAD, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.identitySatisfied).toBe(false);
    });

    it('a missing nursing license alone blocks completion even when everything else is uploaded', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: VALID_UPLOAD, listB: null, listC: null, nursingLicense: null, cprCertification: VALID_UPLOAD } } }));
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(result.current.errors.nursingLicense).toBeTruthy();
      expect(result.current.errors.cprCertification).toBeUndefined();
    });

    it('removing a previously-uploaded required document makes the step incomplete again', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: VALID_UPLOAD, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const complete = renderHook(() => useDocumentsForm());
      let outcome;
      await act(async () => { outcome = await complete.result.current.complete(); });
      expect(outcome).toEqual({ kind: 'saved' });

      // Simulate the document being removed server-side (e.g. via Remove) —
      // a fresh hook instance reading the updated session must see it as
      // incomplete again.
      setupSession(fakeSession({ formData: { uploadedDocuments: { listA: null, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }));
      const after = renderHook(() => useDocumentsForm());
      let afterOutcome;
      await act(async () => { afterOutcome = await after.result.current.complete(); });
      expect(afterOutcome).toEqual({ kind: 'invalid' });
      expect(after.result.current.errors.i9).toBeTruthy();
    });

    it('a locally-selected-but-not-yet-associated file never counts as complete — only the authoritative session value does', async () => {
      // No session-level uploadedDocuments at all — a slot's own local
      // capture/upload-in-flight state (tested in useDocumentSlot.test.ts)
      // never feeds into validateDocuments, which reads only `documents`
      // derived from the session.
      setupSession(fakeSession());
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'invalid' });
    });
  });

  describe('partial save', () => {
    it('saveProgress saves the current uploadedDocuments snapshot and marks in_progress', async () => {
      const { saveStep } = setupSession(fakeSession());
      const { result } = renderHook(() => useDocumentsForm());

      await act(async () => { await result.current.saveProgress(); });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'uploadedDocuments', stepId: 'documents', status: 'in_progress' }));
    });

    it('does not downgrade an already-completed step back to in_progress on a plain save', async () => {
      const { saveStep } = setupSession(fakeSession({ stepStates: { documents: 'completed' } }));
      const { result } = renderHook(() => useDocumentsForm());

      await act(async () => { await result.current.saveProgress(); });

      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict from complete() distinctly from a hard error', async () => {
      setupSession(
        fakeSession({ formData: { uploadedDocuments: { listA: VALID_UPLOAD, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD } } }),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useDocumentsForm());

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'conflict' });
    });
  });

  // M14 hardening: List A vs. List B+List C is an alternative-group
  // requirement, not three independent slots. These tests drive the
  // identity-path state machine directly by controlling what the mocked
  // session shows across re-renders (simulating the session updating after
  // a real association/removal completes), rather than exercising the full
  // capture/upload flow again — useDocumentSlot.test.ts already covers the
  // per-slot upload/associate/remove mechanics in isolation.
  describe('identity path — alternative-group data minimization', () => {
    const identityDocs = (overrides: { listA?: typeof VALID_UPLOAD | null; listB?: typeof VALID_UPLOAD | null; listC?: typeof VALID_UPLOAD | null }) => ({
      listA: null, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD,
      ...overrides,
    });

    it('app/session reconstruction: a fresh mount with only List A present resumes on the List A path', () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.identityPath).toBe('list_a');
    });

    it('app/session reconstruction: a fresh mount with List B+C present resumes on the List B+C path', () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.identityPath).toBe('list_b_c');
    });

    it('a fresh mount with nothing uploaded yet has no path selected — the applicant must choose', () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({}) } }));
      const { result } = renderHook(() => useDocumentsForm());
      expect(result.current.identityPath).toBeNull();
    });

    it('switching from a satisfied List A to List B+C never removes List A while the new path is only partially complete', async () => {
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());

      act(() => result.current.setIdentityPath('list_b_c'));
      rerender(undefined);
      expect(removeDocument).not.toHaveBeenCalled();

      // List B gets uploaded; List C still missing — A must still be intact.
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD }) } }), undefined, removeDocument);
      await act(async () => { rerender(undefined); await Promise.resolve(); });
      expect(removeDocument).not.toHaveBeenCalled();
      expect(result.current.identitySatisfied).toBe(true); // still satisfied via the untouched List A
    });

    it('successful switch from List A to List B+C cleans up the now-unnecessary List A only once both B and C are authoritatively present', async () => {
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD } ) } }), undefined, removeDocument);
      await act(async () => { rerender(undefined); await Promise.resolve(); });

      expect(removeDocument).toHaveBeenCalledWith('list_a');
      expect(removeDocument).not.toHaveBeenCalledWith('list_b');
      expect(removeDocument).not.toHaveBeenCalledWith('list_c');
    });

    it('successful switch from List B+C to List A cleans up the now-unnecessary List B AND List C only once A is authoritatively present', async () => {
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_a'));

      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD } ) } }), undefined, removeDocument);
      await act(async () => { rerender(undefined); await Promise.resolve(); });

      expect(removeDocument).toHaveBeenCalledWith('list_b');
      expect(removeDocument).toHaveBeenCalledWith('list_c');
      expect(removeDocument).not.toHaveBeenCalledWith('list_a');
    });

    it('a never-completed switch (applicant abandons it) never triggers any cleanup — the original valid path is preserved indefinitely', async () => {
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));
      rerender(undefined);
      // Applicant never uploads B or C at all — this is the "failed/abandoned
      // path switch" case; List A must remain the authoritative, satisfied path.
      expect(removeDocument).not.toHaveBeenCalled();
      expect(result.current.identitySatisfied).toBe(true);
    });

    it('a 409 on the new path\'s association leaves the session unchanged — cleanup still never fires', async () => {
      // A 409 means the association never actually wrote the new file into
      // the session, so `documents.listB`/`listC` never reflect it — the
      // cleanup effect's "is the new path complete" condition is never
      // true, exactly like an abandoned switch. Modeled here directly via
      // the session simply never showing B/C, the observable effect of a
      // 409 at the useDocumentSlot layer (already covered in
      // useDocumentSlot.test.ts's own conflict test).
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));
      rerender(undefined);

      expect(removeDocument).not.toHaveBeenCalled();
      expect(result.current.identitySatisfied).toBe(true);
    });

    it('switching paths never affects the unrelated Nursing License / CPR requirements', async () => {
      const removeDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD }) } }), undefined, removeDocument);
      const { result, rerender } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD } ) } }), undefined, removeDocument);
      await act(async () => { rerender(undefined); await Promise.resolve(); });

      expect(removeDocument).not.toHaveBeenCalledWith('nursing_license');
      expect(removeDocument).not.toHaveBeenCalledWith('cpr_cert');
      expect(result.current.slotHooks.nursing_license.status).toBe('uploaded');
      expect(result.current.slotHooks.cpr_cert.status).toBe('uploaded');
    });
  });

  // M14 hardening (second pass): retaining the old path for rollback
  // safety must never let it silently satisfy the path the applicant has
  // actively, explicitly SELECTED — Continue must gate on the selected
  // path's own completeness, not merely on "does the shared rule consider
  // something on file good enough."
  describe('identity path — Continue gates on the SELECTED path, not merely on whatever is retained', () => {
    const identityDocs = (overrides: { listA?: typeof VALID_UPLOAD | null; listB?: typeof VALID_UPLOAD | null; listC?: typeof VALID_UPLOAD | null }) => ({
      listA: null, listB: null, listC: null, nursingLicense: VALID_UPLOAD, cprCertification: VALID_UPLOAD,
      ...overrides,
    });

    it('valid List A, switched to List B+C, only List B uploaded → Complete is blocked even though List A still authoritatively satisfies the shared rule', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD } ) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      // The shared rule alone would allow this (List A is still on file) —
      // confirm the gap would exist if `errors` were checked in isolation.
      expect(result.current.errors.i9).toBeUndefined();

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(result.current.identityPathError).toMatch(/List C/i);
    });

    it('valid List A, switched to List B+C, both List B and List C uploaded → Complete is allowed', async () => {
      const { saveStep } = setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalled();
    });

    it('valid List B+C, switched to List A, List A not yet uploaded → Complete is blocked even though List B+C still authoritatively satisfies the shared rule', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_a'));

      expect(result.current.errors.i9).toBeUndefined();

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(result.current.identityPathError).toMatch(/List A/i);
    });

    it('valid List B+C, switched to List A, List A uploaded → Complete is allowed', async () => {
      const { saveStep } = setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_a'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalled();
    });

    it('never blocks Save Progress — only Complete is gated on the selected path', async () => {
      const { saveStep } = setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalled();
    });

    it('failed/abandoned switch preserves the OLD authoritative valid path, and Continue succeeds again once the applicant switches back to it', async () => {
      setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD } ) } }));
      const { result } = renderHook(() => useDocumentsForm());
      act(() => result.current.setIdentityPath('list_b_c'));

      let blocked;
      await act(async () => { blocked = await result.current.complete(); });
      expect(blocked).toEqual({ kind: 'invalid' });

      // The applicant gives up on the switch and goes back to the path
      // that's still genuinely, authoritatively valid — nothing was ever
      // destroyed, so Continue now succeeds immediately.
      act(() => result.current.setIdentityPath('list_a'));
      let allowed;
      await act(async () => { allowed = await result.current.complete(); });
      expect(allowed).toEqual({ kind: 'saved' });
    });

    it('restarting after an abandoned incomplete switch reconstructs from authoritative documents, not from the abandoned selection — Continue is immediately available again', async () => {
      // Simulates an app restart: `identityPath` is never persisted, so a
      // fresh hook instance re-derives it purely from what the session
      // actually contains. List B was left over from an abandoned switch
      // attempt; List A is still the real, valid, complete path.
      const { saveStep } = setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD } ) } }));
      const { result } = renderHook(() => useDocumentsForm());

      expect(result.current.identityPath).toBe('list_a');
      expect(result.current.identitySatisfied).toBe(true);

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalled();
    });

    it('deterministic reconstruction when both paths temporarily exist at once: List A takes priority, and Continue is immediately available via it', async () => {
      const { saveStep } = setupSession(fakeSession({ formData: { uploadedDocuments: identityDocs({ listA: VALID_UPLOAD, listB: VALID_UPLOAD, listC: VALID_UPLOAD }) } }));
      const { result } = renderHook(() => useDocumentsForm());

      expect(result.current.identityPath).toBe('list_a');

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalled();
    });
  });
});
