import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import VaccineDeclinationScreen from '../VaccineDeclinationScreen';
import { useSession } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

// A narrow render test for the ONE piece of UI logic this change adds: the
// proof-upload control is shown only for the "providing proof" answer. (The
// rest of the flow — validation, saving, upload pipeline — is covered at the
// hook level in useVaccineDeclinationForm.test.ts.)

jest.mock('../SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('../uploadApi', () => ({ uploadFile: jest.fn(), deleteUpload: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ stepId: mockStepId }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

let mockStepId = 'hep_b_declination';

const METRICS = { frame: { x: 0, y: 0, width: 400, height: 900 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const PROVIDING_LABEL = 'No — I am providing proof of vaccination';
const DECLINING_LABEL = 'Yes — I am declining (read the statement and sign below)';
const UPLOAD_LABEL = /Upload vaccination proof/; // the label carries a nested required marker (*)

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 's', packetId: 'general_rn', packetVersion: 5, firstName: null, lastName: null, email: null, phone: null,
    stepStates: {}, formData: {}, status: 'active', applicationId: null, revision: 1, completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  } as SessionResponse;
}

// Button ignores a second press in the same tick (its double-tap guard), so
// consecutive presses in a test need a tick between them, like a real user.
async function press(label: string | RegExp) {
  fireEvent.press(screen.getByText(label));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function renderScreen(s: SessionResponse = session()) {
  (useSession as jest.Mock).mockReturnValue({
    session: s, saveStep: jest.fn(), associateDocument: jest.fn(), removeDocument: jest.fn(), status: 'ready', progress: null, error: null, refresh: jest.fn(),
  });
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>
        <VaccineDeclinationScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe.each(['hep_b_declination', 'tdap_declination', 'flu_declination'])('VaccineDeclinationScreen (%s)', (stepId) => {
  beforeEach(() => {
    mockStepId = stepId;
    jest.clearAllMocks();
  });

  it('offers exactly the two existing options (wording unchanged)', () => {
    renderScreen();
    expect(screen.getByText(DECLINING_LABEL)).toBeTruthy();
    expect(screen.getByText(PROVIDING_LABEL)).toBeTruthy();
  });

  it('shows NO proof upload before an answer is chosen', () => {
    renderScreen();
    expect(screen.queryByText(UPLOAD_LABEL)).toBeNull();
  });

  it('shows the required proof upload (with capture options) when the applicant is providing proof', () => {
    renderScreen();
    fireEvent.press(screen.getByText(PROVIDING_LABEL));
    expect(screen.getByText(UPLOAD_LABEL)).toBeTruthy();
    expect(screen.getByText('Scan Document')).toBeTruthy();
    expect(screen.getByText('Choose from Photos')).toBeTruthy();
    expect(screen.getByText('Choose a PDF')).toBeTruthy();
    // the old "optional" note is gone
    expect(screen.queryByText(/optional right now/i)).toBeNull();
  });

  it('does NOT show the proof upload for a true declination', () => {
    renderScreen();
    fireEvent.press(screen.getByText(DECLINING_LABEL));
    expect(screen.queryByText(UPLOAD_LABEL)).toBeNull();
    expect(screen.queryByText('Scan Document')).toBeNull();
  });

  it('hides the upload again when changing from providing proof to declining, and shows it again when switching back', async () => {
    renderScreen();
    await press(PROVIDING_LABEL);
    expect(screen.getByText(UPLOAD_LABEL)).toBeTruthy();
    await press(DECLINING_LABEL);
    expect(screen.queryByText(UPLOAD_LABEL)).toBeNull();
    await press(PROVIDING_LABEL);
    expect(screen.getByText(UPLOAD_LABEL)).toBeTruthy();
  });

  it('shows an already-uploaded proof (file name + Replace/Remove) when returning to the step', () => {
    renderScreen(
      session({ formData: { vaccineProofDocuments: { [stepId]: { name: 'my-card.pdf', size: 2048, type: 'application/pdf', objectKey: 'uploads/1/x.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' } }, acknowledgements: { [stepId]: { decision: 'providing_proof', checked: false, typedSignature: '', signedAt: '' } } } }),
    );
    expect(screen.getByText('my-card.pdf')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
  });

  it('switching declining -> providing proof again shows the EXISTING upload (no re-upload needed)', async () => {
    renderScreen(
      session({ formData: { vaccineProofDocuments: { [stepId]: { name: 'kept-card.pdf', size: 2048, type: 'application/pdf', objectKey: 'uploads/1/kept.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' } } } }),
    );
    await press(DECLINING_LABEL);
    expect(screen.queryByText('kept-card.pdf')).toBeNull(); // not shown as evidence while declining
    await press(PROVIDING_LABEL);
    expect(screen.getByText('kept-card.pdf')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
  });
});
