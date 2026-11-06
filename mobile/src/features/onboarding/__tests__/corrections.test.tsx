import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import { DocumentSlotCard } from '../../../components/DocumentSlotCard';
import { CorrectionsCard } from '../../../components/CorrectionsCard';
import { CorrectionsContext, needsAction } from '../CorrectionsContext';
import { correctionDocTypes, correctionIntro, correctionSlotFor } from '../CorrectionScreen';
import { CREDENTIAL_DOCUMENT_REQUIREMENT, IDENTITY_DOCUMENT_REQUIREMENT, RESUME_REQUIREMENT, VACCINATION_PROOF_REQUIREMENT, VOIDED_CHECK_REQUIREMENT } from '../../documents/documentRequirements';
import type { useDocumentSlot } from '../../documents/useDocumentSlot';
import type { OpenCorrection } from '../sessionApi';

// A recruiter's correction request, as the applicant sees it: on the
// document's own upload card, and as an "Action needed" card on Home.

const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };
const correction = (over: Partial<OpenCorrection> = {}): OpenCorrection => ({
  requirement: 'cpr_cert', label: 'CPR / BLS certification', docTypes: ['cpr_cert'], status: 'needs_correction', note: 'Card is expired', requestedAt: null, ...over,
});

function hook(docType: string) {
  const capture = { pending: null, pendingItems: [], permissionError: null, scan: jest.fn(), takePhoto: jest.fn(), pickFromLibrary: jest.fn(), pickDocument: jest.fn(), retake: jest.fn(), removePending: jest.fn(), confirmUse: jest.fn() };
  const file = { name: 'cpr.jpg', size: 2048, type: 'image/jpeg', objectKey: 'uploads/1/cpr.jpg' };
  return {
    docType, status: 'uploaded', file, attachments: [file], requirement: CREDENTIAL_DOCUMENT_REQUIREMENT, allowsMultiple: true, canAddMore: true, progress: null, errorMessage: null,
    replacing: null, addingMore: false, startReplace: jest.fn(), startAddingMore: jest.fn(), cancelChoosing: jest.fn(), retry: jest.fn(), cancelFailed: jest.fn(), remove: jest.fn(), removeAttachment: jest.fn(),
    capture,
  } as unknown as ReturnType<typeof useDocumentSlot>;
}

function withCorrections(corrections: OpenCorrection[], node: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>
        <CorrectionsContext.Provider value={{ corrections }}>{node}</CorrectionsContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('correction notice on the upload card', () => {
  it('shows which document needs attention, the reason, and keeps the normal upload actions', () => {
    withCorrections([correction()], <DocumentSlotCard slot={{ label: 'CPR / BLS' }} hook={hook('cpr_cert')} />);
    expect(screen.getByTestId('correction-notice')).toBeTruthy();
    expect(screen.getByText('Needs correction')).toBeTruthy();
    expect(screen.getByText('Card is expired')).toBeTruthy();
    expect(screen.getByText('Upload More')).toBeTruthy();
    expect(screen.getByLabelText('Replace cpr.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Remove cpr.jpg')).toBeTruthy();
  });

  it('says it was sent back once a corrected file is uploaded', () => {
    withCorrections([correction({ status: 'pending' })], <DocumentSlotCard slot={{ label: 'CPR / BLS' }} hook={hook('cpr_cert')} />);
    expect(screen.queryByTestId('correction-notice')).toBeNull();
    expect(screen.getByTestId('correction-sent')).toBeTruthy();
  });

  it('shows nothing on a different document, or with no corrections at all', () => {
    withCorrections([correction()], <DocumentSlotCard slot={{ label: 'License' }} hook={hook('nursing_license')} />);
    expect(screen.queryByTestId('correction-notice')).toBeNull();
    // Outside any provider there are simply no corrections.
    render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><DocumentSlotCard slot={{ label: 'CPR' }} hook={hook('cpr_cert')} /></ThemeProvider></SafeAreaProvider>);
    expect(screen.queryByText('Needs correction')).toBeNull();
  });

  it('an I-9 identity correction applies to whichever list the applicant uploaded', () => {
    withCorrections([correction({ requirement: 'i9_identity', label: 'I-9 identity document', docTypes: ['list_a', 'list_b', 'list_c'], note: 'Photo is cut off' })],
      <DocumentSlotCard slot={{ label: 'List B' }} hook={hook('list_b')} />);
    expect(screen.getByText('Photo is cut off')).toBeTruthy();
  });
});

describe('Action needed card', () => {
  it('lists each document still waiting on the applicant, with its reason and a Fix action', () => {
    const onFix = jest.fn();
    withCorrections([], <CorrectionsCard corrections={[correction(), correction({ requirement: 'applicant_resume', label: 'Resume', docTypes: ['applicant_resume'], note: 'Please send the latest version' }), correction({ requirement: 'nursing_license', label: 'License', status: 'pending' })]} onFix={onFix} />);
    expect(screen.getByText('Action needed')).toBeTruthy();
    expect(screen.getByText('Card is expired')).toBeTruthy();
    expect(screen.getByText('Please send the latest version')).toBeTruthy();
    expect(screen.queryByText('License')).toBeNull();
    fireEvent.press(screen.getAllByText('Fix Document')[1]);
    expect(onFix).toHaveBeenCalledWith('applicant_resume');
  });

  it('renders nothing when nothing needs action', () => {
    withCorrections([], <CorrectionsCard corrections={[correction({ status: 'pending' })]} onFix={jest.fn()} />);
    expect(screen.queryByText('Action needed')).toBeNull();
    expect(needsAction([correction({ status: 'pending' })])).toEqual([]);
  });
});

describe('correction screen document setup', () => {
  it('reuses each document type\'s own card copy and capture options', () => {
    expect(correctionSlotFor('cpr_cert')!.requirement).toBe(CREDENTIAL_DOCUMENT_REQUIREMENT);
    expect(correctionSlotFor('list_b')!.requirement).toBe(IDENTITY_DOCUMENT_REQUIREMENT);
    expect(correctionSlotFor('applicant_resume')!.requirement).toBe(RESUME_REQUIREMENT);
    expect(correctionSlotFor('direct_deposit_voided_check')!.requirement).toBe(VOIDED_CHECK_REQUIREMENT);
    expect(correctionSlotFor('flu_vaccination_proof')).toMatchObject({ slot: { label: 'Influenza vaccination proof' }, requirement: VACCINATION_PROOF_REQUIREMENT });
    expect(correctionSlotFor('verified_license')).toBeNull();
  });

  it('shows the I-9 list(s) the applicant actually used, or every list if none', () => {
    const lists = ['list_a', 'list_b', 'list_c'];
    const file = { name: 'x.jpg', size: 1, type: 'image/jpeg', objectKey: 'k', uploadedAt: '' };
    expect(correctionDocTypes(lists, { uploadedDocuments: { listB: file, listC: file } })).toEqual(['list_b', 'list_c']);
    expect(correctionDocTypes(lists, {})).toEqual(lists);
  });
});

describe('correction screen copy', () => {
  it('after submission, says only this one document is being updated', () => {
    expect(correctionIntro('needs_correction', true)).toContain('already submitted');
    expect(correctionIntro('needs_correction', true)).toContain('only this document');
    expect(correctionIntro('needs_correction', false)).not.toContain('submitted');
    expect(correctionIntro('pending', true)).toContain('sent back for review');
  });
});
