import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import ReviewScreen from '../ReviewScreen';
import EmploymentApplicationScreen from '../EmploymentApplicationScreen';
import DirectDepositScreen from '../DirectDepositScreen';
import { useSession } from '../SessionContext';
import { deriveProgress } from '../steps';
import type { SessionResponse } from '../sessionApi';

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
jest.mock('expo-file-system', () => ({ File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })), Paths: { cache: 'file:///cache' } }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), push: jest.fn(), dismissAll: jest.fn(), canDismiss: () => true }),
  useLocalSearchParams: () => ({ stepId: 'employment_application' }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };
const FILE = (name: string) => ({ name, size: 2048, type: 'image/jpeg', objectKey: `uploads/1/${name}` });

function provide(formData: Record<string, unknown>) {
  const session = {
    sessionId: 's', packetId: 'general_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
    stepStates: {}, formData, status: 'active', applicationId: null, revision: 1, completionPercent: 50,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as SessionResponse;
  (useSession as jest.Mock).mockReturnValue({
    session, status: 'ready', error: null, refresh: jest.fn(), saveStep: jest.fn(), associateDocument: jest.fn(), removeDocument: jest.fn(), submitApplication: jest.fn(),
    progress: deriveProgress(session.packetId, session.stepStates, session.formData),
  });
}

function show(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);
}

describe('Review — structured experience and attachments', () => {
  it('shows the total years and every clinical specialty, separately from the unit preference', () => {
    provide({ employmentApplication: { positionApplied: 'RN', totalYearsExperience: '2.5', primaryClinicalSpecialty: ['icu', 'er'], specialtyPreference: ['or'] } });
    show(<ReviewScreen />);
    expect(screen.getByText('Total Years of Professional Experience')).toBeTruthy();
    expect(screen.getByText('2.5 years')).toBeTruthy();
    expect(screen.getByText('Primary Clinical Specialty')).toBeTruthy();
    expect(screen.getByText('ICU, ER')).toBeTruthy();
    expect(screen.getByText('Specialty / Unit Preference')).toBeTruthy();
    expect(screen.getByText('OR')).toBeTruthy();
  });

  it('a new graduate with no specialty still reads clearly', () => {
    provide({ employmentApplication: { positionApplied: 'LVN', totalYearsExperience: '0', primaryClinicalSpecialty: [] } });
    show(<ReviewScreen />);
    expect(screen.getByText('0 years')).toBeTruthy();
    expect(screen.getByText('Primary Clinical Specialty')).toBeTruthy();
  });

  it('a CNA reads the canonical CNA value', () => {
    provide({ employmentApplication: { positionApplied: 'CNA', totalYearsExperience: '1', primaryClinicalSpecialty: ['icu'] } });
    show(<ReviewScreen />);
    expect(screen.getByText('1 year')).toBeTruthy();
    expect(screen.getAllByText('CNA').length).toBeGreaterThanOrEqual(2);
  });

  it('shows how many attachments the optional license and a vaccine proof hold', () => {
    provide({
      uploadedDocuments: { nursingLicense: FILE('front.jpg') },
      vaccineProofDocuments: { hep_b_declination: FILE('dose-1.jpg') },
      acknowledgements: { hep_b_declination: { decision: 'providing_proof' } },
      documentAttachments: {
        nursing_license: [FILE('front.jpg'), FILE('back.jpg')],
        hep_b_vaccination_proof: [FILE('dose-1.jpg'), FILE('dose-2.jpg'), FILE('dose-3.jpg')],
      },
    });
    show(<ReviewScreen />);
    expect(screen.getByText('Professional License / Certification (optional)')).toBeTruthy();
    expect(screen.getByText('2 attachments')).toBeTruthy();
    expect(screen.getByText('Providing Proof — 3 attachments')).toBeTruthy();
  });

  it('a session with neither new field still renders', () => {
    provide({ employmentApplication: { positionApplied: 'RN', yearsExperience: '3-5', primarySpecialty: 'icu' } });
    show(<ReviewScreen />);
    expect(screen.getByText('Applicant Details')).toBeTruthy();
  });
});

describe('Applicant Details', () => {
  it('asks for the years and multi-select clinical specialty, with the position taxonomy', () => {
    provide({ employmentApplication: { positionApplied: 'Tech' } });
    show(<EmploymentApplicationScreen />);
    expect(screen.getByText(/Total Years of Professional Experience/)).toBeTruthy();
    expect(screen.getByText(/Primary Clinical Specialty/)).toBeTruthy();
    expect(screen.getAllByText('CT Tech')).toHaveLength(2); // both questions, one taxonomy
    expect(screen.queryByText('ICU')).toBeNull();
  });

  it('marks the clinical specialty optional at 0 years, and keeps the question available', () => {
    provide({ employmentApplication: { positionApplied: 'LVN', totalYearsExperience: '0' } });
    show(<EmploymentApplicationScreen />);
    expect(screen.getByText('Optional with no professional experience yet')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 1.5'), '2');
    expect(screen.getByText('Clinical areas where you have experience — select all that apply')).toBeTruthy();
  });

  it('never shows a CNA the one-option specialty questions', () => {
    provide({ employmentApplication: { positionApplied: 'CNA' } });
    show(<EmploymentApplicationScreen />);
    expect(screen.getByText(/Total Years of Professional Experience/)).toBeTruthy();
    expect(screen.queryByText(/Primary Clinical Specialty/)).toBeNull();
    expect(screen.queryByText(/Specialty \/ Unit Preference/)).toBeNull();
    expect(screen.getByText(/CNA applicants need at least 1 year/)).toBeTruthy();
  });

  it('never invents a minimum in the hint for a position without one', () => {
    provide({ employmentApplication: { positionApplied: 'LVN' } });
    show(<EmploymentApplicationScreen />);
    expect(screen.queryByText(/need at least/)).toBeNull();
  });

  it('never asks for employers, titles, or employment dates', () => {
    provide({ employmentApplication: { positionApplied: 'RN' } });
    show(<EmploymentApplicationScreen />);
    for (const absent of [/Employer Name/i, /Job Title/i, /Employment Dates?/i, /Employer Address/i]) {
      expect(screen.queryByText(absent)).toBeNull();
    }
  });

  it('typing a value below the minimum shows the qualification message on blur', () => {
    provide({ employmentApplication: { positionApplied: 'RN' } });
    show(<EmploymentApplicationScreen />);
    const input = screen.getByPlaceholderText('e.g. 1.5');
    fireEvent.changeText(input, '1.9');
    fireEvent(input, 'blur');
    expect(screen.getByText('RN applicants need at least 2 years of professional experience.')).toBeTruthy();
  });
});

describe('Direct Deposit — percentage', () => {
  it('labels the allocation Percentage of Shift, defaulting to 100 for a new entry', () => {
    provide({});
    show(<DirectDepositScreen />);
    expect(screen.getAllByText(/Percentage of Shift \(%\)/).length).toBe(2);
    expect(screen.getAllByDisplayValue('100')).toHaveLength(1);
  });

  it('keeps a saved percentage', () => {
    provide({ directDepositData: { primaryAccount: { depositType: 'percentage', depositAmount: '60' } } });
    show(<DirectDepositScreen />);
    expect(screen.getByDisplayValue('60')).toBeTruthy();
    expect(screen.queryByDisplayValue('100')).toBeNull();
  });

  it('uses the same upload card as every other document', () => {
    provide({});
    show(<DirectDepositScreen />);
    for (const label of ['Scan Document', 'Take a Photo', 'Choose from Photos', 'Choose File']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Choose a PDF')).toBeNull();
  });
});
