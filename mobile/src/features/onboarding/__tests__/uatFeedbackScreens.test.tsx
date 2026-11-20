import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import Home from '../../../../app/(app)/home';
import PersonalInfoScreen from '../PersonalInfoScreen';
import DirectDepositScreen from '../DirectDepositScreen';
import EmploymentApplicationScreen from '../EmploymentApplicationScreen';
import { OnboardingHeader } from '../../../components/OnboardingHeader';
import { OnboardingPhaseHeader } from '../../../components/OnboardingPhaseHeader';
import { useSession } from '../SessionContext';
import { deriveProgress } from '../steps';
import type { SessionResponse } from '../sessionApi';

const mockPush = jest.fn();

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
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), push: mockPush, dismissAll: jest.fn(), canDismiss: () => true }),
  useLocalSearchParams: () => ({ stepId: 'personal_info' }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

const RESUME = { name: 'cv.pdf', size: 100, type: 'application/pdf', objectKey: 'uploads/1/cv.pdf' };
const METRICS = { frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };

function provide(formData: Record<string, unknown>, stepStates: Record<string, string> = {}, status = 'active') {
  const session = {
    sessionId: 's', packetId: 'general_rn', packetVersion: 6, firstName: 'Jane', lastName: null, email: null, phone: null,
    stepStates, formData, status, applicationId: status === 'submitted' ? 'PCS-1' : null, revision: 1, completionPercent: 10,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as SessionResponse;
  (useSession as jest.Mock).mockReturnValue({
    session, saveStep: jest.fn(), status: 'ready', error: null, refresh: jest.fn(), corrections: [],
    progress: deriveProgress(session.packetId, session.stepStates, session.formData),
  });
}

const show = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{ui}</ThemeProvider></SafeAreaProvider>);

beforeEach(() => mockPush.mockClear());

describe('Home — the phase row "Continue →" is tappable', () => {
  it('opens the next incomplete step of the current phase', () => {
    provide({ resumeDocument: RESUME }, { resume: 'completed' });
    show(<Home />);
    const link = screen.getByTestId('phase-continue');
    expect(link.props.accessibilityRole).toBe('button');
    expect(link.props.accessibilityLabel).toBe('Continue Applicant Details & References');
    fireEvent.press(link);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(app)/onboarding/[stepId]', params: { stepId: 'personal_info', origin: 'home' } });
  });

  it('is offered once — only on the current phase', () => {
    provide({ resumeDocument: RESUME }, { resume: 'completed' });
    show(<Home />);
    expect(screen.getAllByTestId('phase-continue')).toHaveLength(1);
  });

  it("is separate from the expandable row's own button, so taps never conflict", () => {
    const onPress = jest.fn();
    const onContinue = jest.fn();
    show(<OnboardingPhaseHeader label="Phase" status="in_progress" completedRequired={1} totalRequired={3} isCurrent onPress={onPress} onContinue={onContinue} expanded={false} />);
    fireEvent.press(screen.getByTestId('phase-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Phase, In progress, collapsed'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('without a target it stays the plain text it was', () => {
    show(<OnboardingPhaseHeader label="Phase" status="in_progress" completedRequired={1} totalRequired={3} isCurrent />);
    expect(screen.queryByTestId('phase-continue')).toBeNull();
    expect(screen.getByText('Continue →')).toBeTruthy();
  });
});

describe('Previous step in the onboarding header', () => {
  it('is shown with the previous step named, and opens it', () => {
    const onPrevious = jest.fn();
    const onBack = jest.fn();
    show(<OnboardingHeader phaseLabel="Applicant Details" stepNumber={2} totalSteps={4} onBack={onBack} previousLabel="Personal Information" onPrevious={onPrevious} />);
    fireEvent.press(screen.getByLabelText('Previous step: Personal Information'));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('is absent when there is no previous step (first step, submitted, or opened from Review)', () => {
    show(<OnboardingHeader phaseLabel="About You" stepNumber={1} totalSteps={1} onBack={jest.fn()} />);
    expect(screen.queryByTestId('previous-step')).toBeNull();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
  });
});

describe('Phone number field', () => {
  it('shows an already saved number as +1 (XXX) XXX-XXXX', () => {
    provide({ personalInfo: { phone: '555-123-4567' } });
    show(<PersonalInfoScreen />);
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeTruthy();
  });

  it('formats as typed and never accepts an 11th digit', () => {
    provide({ personalInfo: { phone: '' } });
    show(<PersonalInfoScreen />);
    const input = screen.getByPlaceholderText('+1 (555) 123-4567');
    fireEvent.changeText(input, '555');
    expect(screen.getByDisplayValue('+1 (555')).toBeTruthy();
    fireEvent.changeText(screen.getByDisplayValue('+1 (555'), '+1 555 123 4567');
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeTruthy();
    fireEvent.changeText(screen.getByDisplayValue('+1 (555) 123-4567'), '+1 (555) 123-45678');
    expect(screen.getByDisplayValue('+1 (555) 123-4567')).toBeTruthy();
  });
});

describe('Direct Deposit authorization', () => {
  it('shows the full authorization sentence from the official form, unclipped', () => {
    provide({});
    show(<DirectDepositScreen />);
    const text = screen.getByText(
      'I authorize my employer to make deposits to my account. In the unlikely event of a deposit error, I authorize my employer to make adjustments to correct the error.',
    );
    expect(text.props.numberOfLines).toBeUndefined();
  });
});

describe('Preferred Primary Specialties', () => {
  it('is the applicant-facing label; the unit preference keeps its own', () => {
    provide({ employmentApplication: { positionApplied: 'RN', totalYearsExperience: '2' } });
    show(<EmploymentApplicationScreen />);
    expect(screen.getByText(/Preferred Primary Specialties/)).toBeTruthy();
    expect(screen.queryByText(/Primary Clinical Specialty/)).toBeNull();
    expect(screen.getByText(/Specialty \/ Unit Preference/)).toBeTruthy();
    expect(screen.getByText(/today or later/)).toBeTruthy();
  });
});
