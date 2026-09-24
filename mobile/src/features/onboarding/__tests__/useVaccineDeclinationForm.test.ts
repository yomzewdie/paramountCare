import { renderHook, act } from '@testing-library/react-native';
import { getPacket } from '@pcs/shared';
import { useVaccineDeclinationForm } from '../useVaccineDeclinationForm';
import { useSession } from '../SessionContext';
import type { SaveStepResult } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';
import * as ImagePicker from 'expo-image-picker';
import { uploadFile } from '../uploadApi';

jest.mock('../SessionContext', () => ({
  useSession: jest.fn(),
}));

// The proof slot reuses the app's one secure upload pipeline
// (useDocumentSlot -> useFileAttachment -> uploadApi -> associateDocument),
// so the same native/network boundaries are stubbed as in the other
// document tests.
jest.mock('../uploadApi', () => ({ uploadFile: jest.fn(), deleteUpload: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('react-native-document-scanner-plugin', () => ({
  __esModule: true,
  default: { scanDocument: jest.fn() },
  ResponseType: { ImageFilePath: 'imageFilePath', Base64: 'base64' },
}));
jest.mock('expo-file-system', () => ({ File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })) }));

const mockedUseSession = useSession as jest.Mock;
const mockedUploadFile = uploadFile as jest.Mock;

const PROOF_FILE = { name: 'vaccine-record.jpg', size: 100, type: 'image/jpeg', objectKey: 'uploads/1/vaccine-record.jpg', uploadedAt: '2026-01-01T00:00:00.000Z' };
const DOC_TYPE_BY_STEP: Record<string, string> = {
  hep_b_declination: 'hep_b_vaccination_proof',
  tdap_declination: 'tdap_vaccination_proof',
  flu_declination: 'flu_vaccination_proof',
};

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

function setupSession(session: SessionResponse, saveStepImpl?: jest.Mock, docMocks: { associateDocument?: jest.Mock; removeDocument?: jest.Mock } = {}) {
  const saveStep = saveStepImpl ?? jest.fn();
  const saved = { status: 'saved', session: fakeSession() } satisfies SaveStepResult;
  mockedUseSession.mockReturnValue({
    session,
    saveStep,
    associateDocument: docMocks.associateDocument ?? jest.fn().mockResolvedValue(saved),
    removeDocument: docMocks.removeDocument ?? jest.fn().mockResolvedValue(saved),
    status: 'ready',
    progress: null,
    error: null,
    refresh: jest.fn(),
  });
  return saveStep;
}

/** A session that already has this vaccine step's proof attached. */
function sessionWithProof(stepId: string, overrides: Partial<SessionResponse> = {}): SessionResponse {
  return fakeSession({ formData: { vaccineProofDocuments: { [stepId]: PROOF_FILE } }, ...overrides });
}

beforeEach(() => jest.clearAllMocks());

/**
 * M14 generalized this from a single hep_b_declination suite once
 * tdap_declination was independently confirmed (not assumed) to share the
 * exact same packet config shape and web behavior — see ADR-027. M15 added
 * flu_declination after an identical direct comparison (ADR-028) — every
 * scenario below runs once per real vaccine step this app registers, the
 * same reuse-proof pattern useAcknowledgementForm.test.ts already
 * established for the acknowledgement family.
 */
const VACCINE_STEP_IDS = ['hep_b_declination', 'tdap_declination', 'flu_declination'];

describe.each(VACCINE_STEP_IDS)('useVaccineDeclinationForm(%s)', (STEP_ID) => {
  const OTHER_STEP_ID = VACCINE_STEP_IDS.find((id) => id !== STEP_ID)!;

  describe('loading', () => {
    it(`reads heading, requiresSignature, and vaccineType from the real ${STEP_ID} packet config`, () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      const step = getPacket('general_rn')!.steps.find((s) => s.id === STEP_ID)!;
      expect(result.current.heading).toBe(step.label);
      expect(result.current.requiresSignature).toBe(step.config?.requiresSignature);
      expect(result.current.vaccineType).toBe(step.config?.vaccineType);
    });

    it('starts with no decision made and no errors shown', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      expect(result.current.data.decision).toBeNull();
      expect(result.current.errors).toEqual({});
    });

    it('reads only its OWN stepId, ignoring a different acknowledgement stored under the same key', () => {
      setupSession(fakeSession({ formData: { acknowledgements: { [OTHER_STEP_ID]: { checked: true, typedSignature: 'Other', signedAt: '2026-01-01T00:00:00.000Z', decision: 'declining' } } } }));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      expect(result.current.data.decision).toBeNull();
    });
  });

  describe('decision branching', () => {
    it('choosing "declining" then switching to "providing_proof" clears checked/typedSignature/signedAt', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));
      expect(result.current.data.checked).toBe(true);
      expect(result.current.data.typedSignature).toBe('Jane Doe');

      act(() => result.current.setDecision('providing_proof'));
      expect(result.current.data.checked).toBe(false);
      expect(result.current.data.typedSignature).toBe('');
      expect(result.current.data.signedAt).toBe('');
    });

    it('staying on "declining" preserves checked/typedSignature when re-selected', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setDecision('declining'));
      expect(result.current.data.checked).toBe(true);
    });

    it('choosing "providing_proof" shows no error yet — the proof requirement is revealed on the first Continue attempt', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));
      expect(result.current.errors).toEqual({});
    });
  });

  describe('validation', () => {
    it('complete() blocks and reveals the decision error when nothing has been selected', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.decision).toBeTruthy();
    });

    it('complete() blocks when declining but unchecked/unsigned', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.checked).toBeTruthy();
      expect(result.current.errors.typedSignature).toBeTruthy();
    });
  });

  describe('complete', () => {
    it('completes once "providing_proof" is selected AND the proof is uploaded', async () => {
      const saveStep = setupSession(
        sessionWithProof(STEP_ID),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepId: STEP_ID }));
    });

    it('completes once declining with a checked box and typed signature', async () => {
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
    });

    it('preserves a DIFFERENT acknowledgement already saved under the same formData key', async () => {
      const otherAck = { checked: true, typedSignature: 'Other Step', signedAt: '2026-01-01T00:00:00.000Z' };
      const saveStep = setupSession(
        fakeSession({ formData: { acknowledgements: { application_statement: otherAck } } }),
        jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      await act(async () => { await result.current.saveProgress(); });

      const [call] = saveStep.mock.calls;
      const savedStepData = call[0].stepData as Record<string, unknown>;
      expect(savedStepData.application_statement).toEqual(otherAck);
    });
  });

  describe('conflict handling', () => {
    it('surfaces a conflict and remembers the latest server value without touching local edits', async () => {
      const latestSession = fakeSession({ formData: { acknowledgements: { [STEP_ID]: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' } } } });
      setupSession(
        fakeSession(),
        jest.fn().mockResolvedValue({ status: 'conflict', latestSession } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'conflict' });
      expect(result.current.conflict?.latest.decision).toBe('providing_proof');
      expect(result.current.data.decision).toBe('declining');
    });
  });

  describe('server validation rejection (defense-in-depth)', () => {
    it('treats a "validation"-coded save error as a local invalid outcome, revealing real field errors instead of a generic banner', async () => {
      const saveStep = setupSession(
        fakeSession({ formData: {} }), // no decision made — a real error exists
        jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(result.current.saveError).toBeNull();
      expect(result.current.errors.decision).toBeDefined();
      expect(saveStep).toHaveBeenCalledTimes(1);
    });

    it('falls back to the generic error banner when there is nothing locally invalid to reveal (data already valid)', async () => {
      const validEntry = { decision: 'declining' as const, checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z' };
      setupSession(
        fakeSession({ formData: { acknowledgements: { [STEP_ID]: validEntry } } }),
        jest.fn().mockResolvedValue({ status: 'error', error: { code: 'validation', message: 'Please check the highlighted fields and try again.' } } satisfies SaveStepResult),
      );
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      let outcome;
      await act(async () => { outcome = await result.current.saveProgress(); });

      expect(outcome).toEqual({ kind: 'error', message: 'Please check the highlighted fields and try again.' });
      expect(result.current.saveError).toBe('Please check the highlighted fields and try again.');
    });
  });

  describe('vaccination proof (required only when providing proof)', () => {
    it('targets this vaccine\'s own document slot', () => {
      setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      expect(result.current.proofSlot.docType).toBe(DOC_TYPE_BY_STEP[STEP_ID]);
      expect(result.current.proofSlotDef.docType).toBe(DOC_TYPE_BY_STEP[STEP_ID]);
    });

    it('providing proof WITHOUT an upload: Continue is blocked, nothing is saved, and the proof error is shown', async () => {
      const saveStep = setupSession(fakeSession());
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'invalid' });
      expect(saveStep).not.toHaveBeenCalled();
      expect(result.current.errors.vaccineProofDocument).toBeTruthy();
      // the checkbox/signature belong to the declining path only
      expect(result.current.errors.checked).toBeUndefined();
      expect(result.current.errors.typedSignature).toBeUndefined();
    });

    it('providing proof WITH an upload: completes', async () => {
      const saveStep = setupSession(sessionWithProof(STEP_ID), jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('providing_proof'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', stepId: STEP_ID }));
      expect(result.current.errors.vaccineProofDocument).toBeUndefined();
    });

    it('a true declination never requires proof (and shows no proof error)', async () => {
      const saveStep = setupSession(fakeSession(), jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });

      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledTimes(1);
      expect(result.current.errors.vaccineProofDocument).toBeUndefined();
    });

    it('changing from "providing proof" to a declination clears the stale proof requirement (no blocked Continue)', async () => {
      const saveStep = setupSession(fakeSession(), jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('providing_proof'));
      await act(async () => { await result.current.complete(); }); // blocked: proof missing
      expect(result.current.errors.vaccineProofDocument).toBeTruthy();

      act(() => result.current.setDecision('declining'));
      expect(result.current.errors.vaccineProofDocument).toBeUndefined();
      act(() => result.current.toggleChecked());
      act(() => result.current.setTypedSignature('Jane Doe'));

      let outcome;
      await act(async () => { outcome = await result.current.complete(); });
      expect(outcome).toEqual({ kind: 'saved' });
      expect(saveStep).toHaveBeenCalledTimes(1);
    });

    it('switching from providing proof to declining does NOT delete an already-uploaded document', () => {
      const removeDocument = jest.fn();
      setupSession(sessionWithProof(STEP_ID), undefined, { removeDocument });
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      act(() => result.current.setDecision('providing_proof'));
      act(() => result.current.setDecision('declining'));

      expect(removeDocument).not.toHaveBeenCalled();
      expect(result.current.proofSlot.file).toEqual(PROOF_FILE);
    });

    it('a previously uploaded proof still satisfies the requirement after switching back to providing proof', () => {
      setupSession(sessionWithProof(STEP_ID));
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));
      act(() => result.current.setDecision('declining'));
      act(() => result.current.setDecision('providing_proof'));
      expect(result.current.proofSlot.status).toBe('uploaded');
      expect(result.current.errors).toEqual({});
    });

    it('uploads through the EXISTING secure pipeline: picker -> uploadApi.uploadFile -> session.associateDocument(<vaccine docType>)', async () => {
      const associateDocument = jest.fn().mockResolvedValue({ status: 'saved', session: fakeSession() } satisfies SaveStepResult);
      setupSession(fakeSession(), undefined, { associateDocument });
      const { result } = renderHook(() => useVaccineDeclinationForm(STEP_ID));

      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'file://record.jpg', fileName: PROOF_FILE.name, mimeType: PROOF_FILE.type, fileSize: PROOF_FILE.size, width: 1200, height: 800 }],
      });
      mockedUploadFile.mockResolvedValue({ ok: true, data: PROOF_FILE });

      await act(async () => { await result.current.proofSlot.capture.pickFromLibrary(); });
      await act(async () => { await result.current.proofSlot.capture.confirmUse(); });

      expect(mockedUploadFile).toHaveBeenCalledTimes(1);
      // The client only ever passes the slot type + the object key the server itself issued at upload.
      expect(associateDocument).toHaveBeenCalledWith(DOC_TYPE_BY_STEP[STEP_ID], PROOF_FILE.objectKey);
    });
  });
});
