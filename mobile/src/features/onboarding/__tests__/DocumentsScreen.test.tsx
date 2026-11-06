import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import DocumentsScreen from '../DocumentsScreen';
import { useSession } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

// Documents & Credentials as a guided checklist (physical-UAT feedback):
// one active upload, completed uploads collapsed, the next requirement
// opened and scrolled into view. Requirements, validation and the upload
// pipeline are unchanged (see useDocumentsForm.test.ts / documentChecklist.test.ts).

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
jest.mock('react-native-document-scanner-plugin', () => ({ __esModule: true, default: { scanDocument: jest.fn() }, ResponseType: { ImageFilePath: 'imageFilePath' } }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissAll: jest.fn(), canDismiss: () => true }),
  useLocalSearchParams: () => ({ stepId: 'documents' }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };
const FILE = (name: string) => ({ name, size: 2048, type: 'image/jpeg', objectKey: `uploads/1/${name}`, uploadedAt: '2026-10-01T00:00:00Z' });

function session(uploadedDocuments: Record<string, unknown> = {}, formData: Record<string, unknown> = {}): SessionResponse {
  return {
    sessionId: 's', packetId: 'general_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
    stepStates: {}, formData: { uploadedDocuments, ...formData }, status: 'active', applicationId: null, revision: 1, completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as SessionResponse;
}

const mocks = { saveStep: jest.fn(), removeDocument: jest.fn(), associateDocument: jest.fn() };
function provide(s: SessionResponse) {
  (useSession as jest.Mock).mockReturnValue({ session: s, progress: null, status: 'ready', error: null, refresh: jest.fn(), ...mocks });
}
function ui() {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider><DocumentsScreen /></ThemeProvider>
    </SafeAreaProvider>
  );
}
function renderScreen(uploaded: Record<string, unknown> = {}) {
  provide(session(uploaded));
  return render(ui());
}
async function press(label: string | RegExp) {
  fireEvent.press(screen.getByText(label));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const openCards = () => screen.queryAllByText('Scan Document').length + screen.queryAllByText('Remove').length;
const GROUP = (docType: string, files: unknown[]) => ({ documentAttachments: { [docType]: files } });

beforeEach(() => {
  jest.clearAllMocks();
  mocks.saveStep.mockResolvedValue({ status: 'saved', session: session() });
  mocks.removeDocument.mockResolvedValue({ status: 'saved', session: session() });
});

describe('DocumentsScreen — guided checklist', () => {
  it('is titled "Documents & Credentials" with a compact progress summary', () => {
    renderScreen();
    expect(screen.getByText('Documents & Credentials')).toBeTruthy();
    expect(screen.getByText('0 of 2 required documents uploaded')).toBeTruthy();
  });

  it('asks for the identity choice first; no upload card is open until a path is chosen', () => {
    renderScreen();
    expect(screen.getByText('Select an option above to start.')).toBeTruthy();
    expect(openCards()).toBe(0);
    expect(screen.getByTestId('doc-row-nursing_license')).toBeTruthy();
    expect(screen.getByTestId('doc-row-cpr_cert')).toBeTruthy();
  });

  it('the professional license is optional: never the active item, and offered with Add', () => {
    renderScreen({ listA: FILE('a.jpg') });
    expect(screen.getByTestId('doc-open-cpr_cert')).toBeTruthy();
    expect(screen.getByTestId('doc-row-nursing_license')).toBeTruthy();
    expect(screen.getByText('Optional')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Add Professional License / Certification'));
    expect(screen.getByTestId('doc-open-nursing_license')).toBeTruthy();
    expect(screen.getByTestId('doc-open-cpr_cert')).toBeTruthy();
  });

  it('every upload offers the same four actions', async () => {
    renderScreen({ listA: FILE('a.jpg') });
    for (const label of ['Scan Document', 'Take a Photo', 'Choose from Photos', 'Choose File']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('a requirement with several attachments collapses to one row showing the count', () => {
    renderScreen(
      { listA: FILE('a.jpg'), cprCertification: FILE('cpr.pdf'), nursingLicense: FILE('front.jpg') },
    );
    expect(screen.getByText('front.jpg')).toBeTruthy();
    provide(session(
      { listA: FILE('a.jpg'), cprCertification: FILE('cpr.pdf'), nursingLicense: FILE('front.jpg') },
      GROUP('nursing_license', [FILE('front.jpg'), FILE('back.jpg')]),
    ));
    render(ui());
    expect(screen.getByText('2 attachments')).toBeTruthy();
    expect(screen.getByLabelText('Manage Professional License / Certification')).toBeTruthy();
  });

  it('Manage lists every attachment with Replace and Remove, plus Upload More', async () => {
    provide(session(
      { listA: FILE('a.jpg'), cprCertification: FILE('cpr.pdf'), nursingLicense: FILE('front.jpg') },
      GROUP('nursing_license', [FILE('front.jpg'), FILE('back.jpg')]),
    ));
    render(ui());
    fireEvent.press(screen.getByLabelText('Manage Professional License / Certification'));
    expect(screen.getByLabelText('Remove front.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Remove back.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Replace back.jpg')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Remove back.jpg'));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.removeDocument).toHaveBeenCalledWith('nursing_license', 'uploads/1/back.jpg');

    await press('Upload More');
    for (const label of ['Scan Document', 'Take a Photo', 'Choose from Photos', 'Choose File']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('Manage → Replace offers the same actions for just that attachment', () => {
    provide(session(
      { listA: FILE('a.jpg'), cprCertification: FILE('cpr.pdf'), nursingLicense: FILE('front.jpg') },
      GROUP('nursing_license', [FILE('front.jpg'), FILE('back.jpg')]),
    ));
    render(ui());
    fireEvent.press(screen.getByLabelText('Manage Professional License / Certification'));
    fireEvent.press(screen.getByLabelText('Replace back.jpg'));
    expect(screen.getByText('Replace back.jpg')).toBeTruthy();
    expect(screen.getByText('Scan Document')).toBeTruthy();
    expect(screen.queryByText('Upload More')).toBeNull();
  });

  it('List A path: only the List A upload opens; List B / List C are never shown', async () => {
    renderScreen();
    await press('List A document');
    expect(screen.getByTestId('doc-open-list_a')).toBeTruthy();
    expect(screen.getAllByText('Scan Document')).toHaveLength(1);
    expect(screen.queryByText(/List B — Identity Document/)).toBeNull();
    expect(screen.queryByText(/List C — Work Authorization Document/)).toBeNull();
  });

  it('List B + List C path: List B opens first, List C waits as "Up next"; List A is not shown', async () => {
    renderScreen();
    await press('List B + List C documents');
    expect(screen.getByTestId('doc-open-list_b')).toBeTruthy();
    expect(screen.getByTestId('doc-row-list_c')).toBeTruthy();
    expect(screen.queryByText(/List A — Identity & Work Authorization/)).toBeNull();
  });

  it('a completed upload collapses to a row (✓, file name, Manage) and the next requirement is the one open card', () => {
    renderScreen({ listA: FILE('IMG_1642.jpg') });
    expect(screen.getByTestId('doc-row-list_a')).toBeTruthy();
    expect(screen.getByText('IMG_1642.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Manage List A — Identity & Work Authorization')).toBeTruthy();
    expect(screen.getByTestId('doc-open-cpr_cert')).toBeTruthy();
    expect(screen.getAllByText('Scan Document')).toHaveLength(1);
    expect(screen.getByText('1 of 2 required documents uploaded')).toBeTruthy();
  });

  it('follows the packet order: identity → CPR/BLS → the optional professional license', () => {
    renderScreen({ listA: FILE('a.jpg') });
    const order = screen.UNSAFE_getAllByType(View)
      .map((v) => v.props.testID as string | undefined)
      .filter((id): id is string => !!id && /^doc-(row|open)-/.test(id))
      .map((id) => id.replace(/^doc-(row|open)-/, ''));
    expect(order).toEqual(['list_a', 'cpr_cert', 'nursing_license']);
  });

  it('after an upload completes, the next requirement opens and is scrolled into view', () => {
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
    jest.spyOn(View.prototype as unknown as { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void }, 'measureInWindow')
      .mockImplementation((cb) => cb(0, 1200, 375, 300)); // below the fold
    const { rerender } = renderScreen({});
    fireEvent.press(screen.getByText('List B + List C documents'));
    const scroll = screen.UNSAFE_getByType(ScrollView).instance as ScrollView;
    jest.spyOn(scroll, 'getNativeScrollRef').mockReturnValue({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 0, 375, 560) } as never);
    const scrollTo = jest.spyOn(scroll, 'scrollTo').mockImplementation(() => {});

    provide(session({ listB: FILE('b.jpg') })); // the List B upload succeeded
    rerender(ui());
    expect(screen.getByTestId('doc-row-list_b')).toBeTruthy(); // collapsed
    act(() => fireEvent(screen.getByTestId('doc-open-list_c'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 375, height: 300 } } }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('Manage reopens a completed item (with Remove); Done collapses it again', async () => {
    renderScreen({ listA: FILE('a.jpg'), nursingLicense: FILE('license.pdf'), cprCertification: FILE('cpr.pdf') });
    expect(screen.queryByText('Remove')).toBeNull();
    fireEvent.press(screen.getByLabelText('Manage Professional License / Certification'));
    expect(screen.getByTestId('doc-open-nursing_license')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
    await press('Done');
    expect(screen.getByTestId('doc-row-nursing_license')).toBeTruthy();
  });

  it('Remove clears the slot through the secure session route and the item becomes incomplete again', async () => {
    const { rerender } = renderScreen({ listA: FILE('a.jpg'), nursingLicense: FILE('license.pdf'), cprCertification: FILE('cpr.pdf') });
    fireEvent.press(screen.getByLabelText('Manage CPR / BLS Certification'));
    await press('Remove');
    expect(mocks.removeDocument).toHaveBeenCalledWith('cpr_cert');

    provide(session({ listA: FILE('a.jpg'), nursingLicense: FILE('license.pdf') }));
    rerender(ui());
    expect(screen.getByText('1 of 2 required documents uploaded')).toBeTruthy();
    expect(screen.getByTestId('doc-open-cpr_cert')).toBeTruthy();
    expect(screen.queryByTestId('documents-complete')).toBeNull();
  });

  it('complete without the optional license: the step can still finish', () => {
    renderScreen({ listA: FILE('a.jpg'), cprCertification: FILE('cpr.pdf') });
    expect(screen.getByText('All required documents uploaded')).toBeTruthy();
    expect(screen.queryByTestId('doc-open-nursing_license')).toBeNull();
  });

  it('all required uploads complete → a clear success state, every item collapsed', () => {
    renderScreen({ listB: FILE('b.jpg'), listC: FILE('c.jpg'), nursingLicense: FILE('license.pdf'), cprCertification: FILE('cpr.pdf') });
    expect(screen.getByText('All required documents uploaded')).toBeTruthy();
    expect(screen.getByText('2 of 2 required documents uploaded')).toBeTruthy();
    expect(openCards()).toBe(0);
  });

  it('Save Progress is unchanged: saves the step in progress with the stored uploads', async () => {
    renderScreen({ listA: FILE('a.jpg') });
    await press('Save Progress');
    expect(mocks.saveStep).toHaveBeenCalledWith(expect.objectContaining({ formDataKey: 'uploadedDocuments', stepId: 'documents', status: 'in_progress' }));
  });

  it('validation is unchanged: Continue with missing documents saves nothing and explains what is missing', async () => {
    renderScreen({ listA: FILE('a.jpg') });
    await press('Continue');
    expect(mocks.saveStep).not.toHaveBeenCalled();
    expect(screen.getByText('Upload your CPR/BLS certification to continue.')).toBeTruthy();
  });
});
