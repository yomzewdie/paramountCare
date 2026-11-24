import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SAME_FACILITY_REFERENCE_WARNING, defaultEmploymentReference, isSameReferenceFacility } from '@pcs/shared';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import DocumentsScreen from '../DocumentsScreen';
import IdentityDocumentsScreen from '../IdentityDocumentsScreen';
import EmploymentReferenceScreen from '../EmploymentReferenceScreen';
import { correctionDocTypes, correctionSlotFor } from '../CorrectionScreen';
import { useEmploymentReferenceForm } from '../useEmploymentReferenceForm';
import { useDocumentsForm } from '../useDocumentsForm';
import { useSession } from '../SessionContext';
import { deriveProgress } from '../steps';
import type { SessionResponse } from '../sessionApi';

// Paramount Care Identity Documents, reusing them for the I-9 by the
// applicant's own choice, and the Reference #2 same-facility warning.

let mockParams: { stepId: string } = { stepId: 'documents' };
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
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };
const FILE = (name: string) => ({ name, size: 2048, type: 'image/jpeg', objectKey: `uploads/1/${name}`, uploadedAt: '2026-10-01T00:00:00Z' });
const IDENTITY_DOCS = { driversLicense: FILE('dl.jpg'), socialSecurityCard: FILE('ss.jpg') };

function session(formData: Record<string, unknown> = {}, extra: Partial<SessionResponse> = {}): SessionResponse {
  return {
    sessionId: 's', packetId: 'icu_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
    stepStates: {}, formData, status: 'active', applicationId: null, revision: 1, completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  } as SessionResponse;
}

const mocks = { saveStep: jest.fn(), removeDocument: jest.fn(), associateDocument: jest.fn(), reuseForI9: jest.fn() };
function provide(s: SessionResponse) {
  (useSession as jest.Mock).mockReturnValue({ session: s, progress: null, status: 'ready', error: null, refresh: jest.fn(), corrections: [], ...mocks });
}
const show = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  jest.clearAllMocks();
  mocks.saveStep.mockResolvedValue({ status: 'saved', session: session() });
  mocks.reuseForI9.mockResolvedValue({ status: 'saved', session: session() });
});

describe('Identity Documents screen', () => {
  it("asks for the Driver's License and Social Security Card as Paramount Care's own requirement, separate from Form I-9", () => {
    provide(session());
    show(<IdentityDocumentsScreen />);
    expect(screen.getByText('Identity Documents')).toBeTruthy();
    expect(screen.getByText(/Paramount Care requires a copy of your Driver's License and Social Security Card/)).toBeTruthy();
    expect(screen.getByText(/This is separate from Form I-9/)).toBeTruthy();
    expect(screen.queryByText(/I-9 required/i)).toBeNull();
    expect(screen.queryByText(/citizen/i)).toBeNull();
    expect(screen.getByText(/^Driver's License/)).toBeTruthy();
    expect(screen.getByText(/^Social Security Card/)).toBeTruthy();
    expect(screen.getByText('0 of 2 documents uploaded')).toBeTruthy();
  });

  it('offers every normal upload method for each document', () => {
    provide(session());
    show(<IdentityDocumentsScreen />);
    for (const method of ['Scan Document', 'Take a Photo', 'Choose from Photos', 'Choose File']) {
      expect(screen.getAllByText(method)).toHaveLength(2);
    }
  });

  it('Continue is blocked until both are uploaded, then completes the step', async () => {
    provide(session({ uploadedDocuments: { driversLicense: FILE('dl.jpg') } }));
    const { unmount } = show(<IdentityDocumentsScreen />);
    fireEvent.press(screen.getByText('Continue'));
    await flush();
    expect(mocks.saveStep).not.toHaveBeenCalled();
    expect(screen.getByText('Upload your Social Security Card to continue.')).toBeTruthy();
    unmount();

    provide(session({ uploadedDocuments: IDENTITY_DOCS }));
    show(<IdentityDocumentsScreen />);
    expect(screen.getByText('2 of 2 documents uploaded')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));
    await flush();
    expect(mocks.saveStep).toHaveBeenCalledWith(expect.objectContaining({ stepId: 'identity_documents', status: 'completed' }));
  });
});

describe('I-9 document selection with Identity Documents uploaded', () => {
  it('never selects them automatically: uploading them leaves the I-9 choice to the applicant', () => {
    provide(session({ uploadedDocuments: IDENTITY_DOCS }));
    const { result } = renderHook(() => useDocumentsForm());
    expect(result.current.identityPath).toBeNull();
    expect(result.current.identitySatisfied).toBe(false);
    expect(result.current.reuse).toEqual({ list_b: { active: false, available: true }, list_c: { active: false, available: true } });
  });

  it('offers "Use the Driver\'s License already uploaded" for List B, or a different upload', async () => {
    provide(session({ uploadedDocuments: IDENTITY_DOCS }));
    show(<DocumentsScreen />);
    fireEvent.press(screen.getByText('List B + List C documents'));
    await flush();
    expect(screen.getByTestId('reuse-offer-list_b')).toBeTruthy();
    expect(screen.getByText('Or upload a different document:')).toBeTruthy();
    expect(screen.getByText('Scan Document')).toBeTruthy();
    fireEvent.press(screen.getByText("Use the Driver's License already uploaded"));
    await flush();
    expect(mocks.reuseForI9).toHaveBeenCalledWith('list_b', { source: 'drivers_license' });
  });

  it('a Social Security card is used for List C only after the applicant confirms it has no employment restriction', async () => {
    provide(session({
      uploadedDocuments: { ...IDENTITY_DOCS },
      i9DocumentReuse: { list_b: { source: 'drivers_license', selectedAt: 'x' } },
    }));
    show(<DocumentsScreen />);
    fireEvent.press(screen.getByText('List B + List C documents'));
    await flush();
    expect(screen.getByTestId('reuse-offer-list_c')).toBeTruthy();
    const use = screen.getByText('Use the Social Security Card already uploaded');
    fireEvent.press(use);
    await flush();
    expect(mocks.reuseForI9).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(/My Social Security card is not printed with "NOT VALID FOR EMPLOYMENT"/));
    fireEvent.press(screen.getByText('Use the Social Security Card already uploaded'));
    await flush();
    expect(mocks.reuseForI9).toHaveBeenCalledWith('list_c', { source: 'social_security_card', confirmUnrestricted: true });
  });

  it('a reused document counts as that I-9 slot and says where it came from', () => {
    const reused = {
      uploadedDocuments: { ...IDENTITY_DOCS, cprCertification: FILE('cpr.jpg') },
      i9DocumentReuse: {
        list_b: { source: 'drivers_license', selectedAt: 'x' },
        list_c: { source: 'social_security_card', selectedAt: 'x', unrestrictedConfirmed: true },
      },
    };
    provide(session(reused));
    const { result } = renderHook(() => useDocumentsForm());
    expect(result.current.identityPath).toBe('list_b_c');
    expect(result.current.identitySatisfied).toBe(true);
    expect(result.current.errors).toEqual({});

    show(<DocumentsScreen />);
    expect(screen.getByText("Driver's License from Identity Documents")).toBeTruthy();
    expect(screen.getByText('Social Security Card from Identity Documents')).toBeTruthy();
    expect(screen.getByText('2 of 2 required documents uploaded')).toBeTruthy();
  });

  it('a List C reuse without the confirmation does not count', () => {
    provide(session({ uploadedDocuments: IDENTITY_DOCS, i9DocumentReuse: { list_b: { source: 'drivers_license', selectedAt: 'x' }, list_c: { source: 'social_security_card', selectedAt: 'x' } } }));
    const { result } = renderHook(() => useDocumentsForm());
    expect(result.current.reuse.list_c.active).toBe(false);
    expect(result.current.identitySatisfied).toBe(false);
  });

  it('the List C copy no longer implies every Social Security card qualifies', async () => {
    provide(session({ uploadedDocuments: { listB: FILE('state-id.jpg') } }));
    show(<DocumentsScreen />);
    fireEvent.press(screen.getByText('List B + List C documents'));
    await flush();
    expect(screen.getByText(/is not a List C document/)).toBeTruthy();
    expect(screen.getByText(/Social Security card without an employment restriction/)).toBeTruthy();
    expect(screen.queryByText(/Examples: Social Security Card,/)).toBeNull();
    // No Identity Documents uploaded: nothing to reuse is offered.
    expect(screen.queryByTestId('reuse-offer-list_c')).toBeNull();
  });
});

describe('corrections and progress', () => {
  it("a Driver's License or Social Security Card correction opens the right upload card", () => {
    expect(correctionSlotFor('drivers_license')?.slot.label).toBe("Driver's License");
    expect(correctionSlotFor('social_security_card')?.slot.label).toBe('Social Security Card');
  });

  it('an I-9 correction shows a reused slot, so a different document can replace it', () => {
    const formData = { uploadedDocuments: { ...IDENTITY_DOCS, listC: FILE('birth.jpg') }, i9DocumentReuse: { list_b: { source: 'drivers_license', selectedAt: 'x' } } };
    expect(correctionDocTypes(['list_a', 'list_b', 'list_c'], formData)).toEqual(['list_b', 'list_c']);
  });

  it('a submitted application is never shown the later-added step; an in-progress one must complete it', () => {
    const stepStates = { w4: 'completed', i9: 'completed', direct_deposit: 'completed', documents: 'completed' };
    expect(deriveProgress('icu_rn', stepStates, undefined, 'submitted')!.steps.map((s) => s.id)).not.toContain('identity_documents');
    expect(deriveProgress('icu_rn', stepStates, undefined, 'active')!.steps.map((s) => s.id)).toContain('identity_documents');
    expect(deriveProgress('icu_rn', { ...stepStates, identity_documents: 'completed' }, undefined, 'submitted')!.steps.map((s) => s.id)).toContain('identity_documents');
  });
});

describe('Employment Reference #2: same facility as #1', () => {
  const ref1 = { ...defaultEmploymentReference, employerName: 'St. Mary Medical Center' };
  function form(stepId: string, saved: Record<string, unknown> = {}) {
    provide(session({ employmentReferences: { employment_ref_1: ref1, ...saved } }));
    return renderHook(() => useEmploymentReferenceForm(stepId));
  }

  it('compares facilities ignoring capitalization and extra spaces', () => {
    expect(isSameReferenceFacility('St. Mary Medical Center', '  st. mary   MEDICAL center ')).toBe(true);
    expect(isSameReferenceFacility('St. Mary Medical Center', 'St. Joseph Hospital')).toBe(false);
    expect(isSameReferenceFacility('', '')).toBe(false);
    expect(isSameReferenceFacility('St. Mary Medical Center', '   ')).toBe(false);
  });

  it('warns once the facility is entered, not while it is being typed', () => {
    const { result } = form('employment_ref_2');
    act(() => result.current.setField('employerName', '  st. mary medical CENTER '));
    expect(result.current.facilityWarning).toBeNull();
    act(() => result.current.blurField('employerName'));
    expect(result.current.facilityWarning).toBe(SAME_FACILITY_REFERENCE_WARNING);
  });

  it('shows for an already saved matching facility, and never for a different one or a blank Reference #1', () => {
    expect(form('employment_ref_2', { employment_ref_2: { ...defaultEmploymentReference, employerName: 'ST. MARY MEDICAL CENTER' } }).result.current.facilityWarning).toBe(SAME_FACILITY_REFERENCE_WARNING);
    expect(form('employment_ref_2', { employment_ref_2: { ...defaultEmploymentReference, employerName: 'St. Joseph Hospital' } }).result.current.facilityWarning).toBeNull();
    provide(session({ employmentReferences: { employment_ref_2: { ...defaultEmploymentReference, employerName: 'St. Mary Medical Center' } } }));
    expect(renderHook(() => useEmploymentReferenceForm('employment_ref_2')).result.current.facilityWarning).toBeNull();
  });

  it('appears on the Reference #2 screen, beside the facility field', () => {
    mockParams = { stepId: 'employment_ref_2' };
    provide(session({ employmentReferences: { employment_ref_1: ref1, employment_ref_2: { ...defaultEmploymentReference, employerName: 'st. mary medical center' } } }));
    show(<EmploymentReferenceScreen />);
    expect(screen.getByTestId('same-facility-warning')).toBeTruthy();
    expect(screen.getByText(SAME_FACILITY_REFERENCE_WARNING)).toBeTruthy();
    mockParams = { stepId: 'documents' };
  });

  it('only Reference #2 is compared', () => {
    expect(form('employment_ref_1').result.current.facilityWarning).toBeNull();
    expect(form('employment_ref_3', { employment_ref_3: ref1 }).result.current.facilityWarning).toBeNull();
  });

  it('is a warning only: the applicant can continue, and what they typed is saved unchanged', async () => {
    const complete = { ...defaultEmploymentReference, supervisorName: 'Pat Lee', supervisorTitle: 'Charge RN', employerName: ' st. mary medical center', supervisorPhone: '(555) 123-4567', permissionGranted: true };
    const { result } = form('employment_ref_2', { employment_ref_2: complete });
    expect(result.current.facilityWarning).toBe(SAME_FACILITY_REFERENCE_WARNING);
    expect(result.current.errors).toEqual({});
    await act(async () => { await result.current.complete(); });
    expect(mocks.saveStep).toHaveBeenCalledWith(expect.objectContaining({
      stepId: 'employment_ref_2', status: 'completed',
      stepData: expect.objectContaining({ employment_ref_2: complete, employment_ref_1: ref1 }),
    }));
  });
});
