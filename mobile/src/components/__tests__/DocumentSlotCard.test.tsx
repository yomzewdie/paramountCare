import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { DocumentSlotCard } from '../DocumentSlotCard';
import { CREDENTIAL_DOCUMENT_REQUIREMENT, RESUME_REQUIREMENT, type DocumentRequirement } from '../../features/documents/documentRequirements';
import type { useDocumentSlot } from '../../features/documents/useDocumentSlot';

// The one upload UI every onboarding screen uses.

const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } };
const FILE = (name: string) => ({ name, size: 2048, type: 'image/jpeg', objectKey: `uploads/1/${name}` });
const PENDING = (name: string, extra = {}) => ({ picked: { uri: `file://${name}`, name, type: 'image/jpeg' }, issue: null, isTemporaryFile: false, ...extra });

function hook(overrides: Record<string, unknown> = {}, requirement: DocumentRequirement = CREDENTIAL_DOCUMENT_REQUIREMENT) {
  const capture = { pending: null, pendingItems: [], permissionError: null, scan: jest.fn(), takePhoto: jest.fn(), pickFromLibrary: jest.fn(), pickDocument: jest.fn(), retake: jest.fn(), removePending: jest.fn(), confirmUse: jest.fn() };
  return {
    docType: 'nursing_license', status: 'idle', file: null, attachments: [], requirement, allowsMultiple: true, canAddMore: true, progress: null, errorMessage: null,
    replacing: null, addingMore: false, startReplace: jest.fn(), startAddingMore: jest.fn(), cancelChoosing: jest.fn(), retry: jest.fn(), cancelFailed: jest.fn(), remove: jest.fn(), removeAttachment: jest.fn(),
    ...overrides,
    capture: { ...capture, ...(overrides.capture as object | undefined) },
  } as unknown as ReturnType<typeof useDocumentSlot>;
}

function show(h: ReturnType<typeof useDocumentSlot>) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider><DocumentSlotCard slot={{ label: 'Doc' }} hook={h} /></ThemeProvider>
    </SafeAreaProvider>,
  );
}

const ACTIONS = ['Scan Document', 'Take a Photo', 'Choose from Photos', 'Choose File'];

describe('DocumentSlotCard', () => {
  it('offers the same four actions with no attachment yet, and nothing else', () => {
    show(hook());
    for (const label of ACTIONS) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText('Upload More')).toBeNull();
  });

  it('a document-only requirement (the resume) offers only Choose File', () => {
    show(hook({}, RESUME_REQUIREMENT));
    expect(screen.getByText('Choose File')).toBeTruthy();
    for (const label of ACTIONS.slice(0, 3)) expect(screen.queryByText(label)).toBeNull();
  });

  it('with attachments: compact rows with their own Replace/Remove, and Upload More instead of the full action list', () => {
    const a = FILE('front.jpg');
    const b = FILE('back.jpg');
    const h = hook({ status: 'uploaded', file: a, attachments: [a, b] });
    show(h);
    expect(screen.getByTestId('attachment-list')).toBeTruthy();
    expect(screen.queryByText('Scan Document')).toBeNull();

    fireEvent.press(screen.getByLabelText('Remove back.jpg'));
    expect(h.removeAttachment).toHaveBeenCalledWith(b);
    fireEvent.press(screen.getByLabelText('Replace front.jpg'));
    expect(h.startReplace).toHaveBeenCalledWith(a);
    fireEvent.press(screen.getByText('Upload More'));
    expect(h.startAddingMore).toHaveBeenCalled();
  });

  it('Upload More shows the same four actions, with a way back', () => {
    const a = FILE('front.jpg');
    const h = hook({ status: 'uploaded', file: a, attachments: [a], addingMore: true });
    show(h);
    for (const label of ACTIONS) expect(screen.getByText(label)).toBeTruthy();
    fireEvent.press(screen.getByText('Cancel'));
    expect(h.cancelChoosing).toHaveBeenCalled();
  });

  it('no Upload More once the requirement is full, or for a single-file document', () => {
    const a = FILE('resume.pdf');
    show(hook({ status: 'uploaded', file: a, attachments: [a], canAddMore: false }));
    expect(screen.queryByText('Upload More')).toBeNull();
  });

  it('a single-file document replaces straight from the file picker', () => {
    const a = FILE('resume.pdf');
    const h = hook({ status: 'uploaded', file: a, attachments: [a], allowsMultiple: false, canAddMore: false }, RESUME_REQUIREMENT);
    show(h);
    fireEvent.press(screen.getByLabelText('Replace resume.pdf'));
    expect(h.capture.pickDocument).toHaveBeenCalled();
    expect(h.startReplace).not.toHaveBeenCalled();
  });

  it('several chosen photos preview as a strip, not a stack, and confirm together', () => {
    const items = [PENDING('a.jpg'), PENDING('b.jpg'), PENDING('c.jpg')];
    const h = hook({ capture: { pending: items[0], pendingItems: items } });
    show(h);
    expect(screen.getByTestId('pending-thumbnails')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Remove photo 2'));
    expect(h.capture.removePending).toHaveBeenCalledWith(1);
    fireEvent.press(screen.getByText('Use 3 Photos'));
    expect(h.capture.confirmUse).toHaveBeenCalled();
  });

  it('one problem photo blocks Use and says why', () => {
    const items = [PENDING('a.jpg'), PENDING('tiny.jpg', { issue: 'This image is too small to read clearly.' })];
    const h = hook({ capture: { pending: items[0], pendingItems: items } });
    show(h);
    expect(screen.getByText('This image is too small to read clearly.')).toBeTruthy();
    fireEvent.press(screen.getByText('Use 2 Photos'));
    expect(h.capture.confirmUse).not.toHaveBeenCalled();
  });

  it('a merged scan shows its name and page count', () => {
    const item = { picked: { uri: 'file://scan.pdf', name: 'scanned-document.pdf', type: 'application/pdf' }, issue: null, isTemporaryFile: true, pageCount: 3 };
    show(hook({ capture: { pending: item, pendingItems: [item] } }));
    expect(screen.getByText('scanned-document.pdf — 3 pages')).toBeTruthy();
    expect(screen.getByText('Use Document')).toBeTruthy();
  });

  it('shows which file of a multi-file upload is in progress', () => {
    show(hook({ status: 'uploading', progress: { current: 2, total: 3 } }));
    expect(screen.getByText('Uploading 2 of 3…')).toBeTruthy();
  });

  it('a failed upload offers Retry and Cancel, keeping what is already attached in view', () => {
    const a = FILE('front.jpg');
    const h = hook({ status: 'failed', file: a, attachments: [a], errorMessage: 'No connection.' });
    show(h);
    expect(screen.getByText('No connection.')).toBeTruthy();
    expect(screen.getByLabelText('Remove front.jpg')).toBeTruthy();
    fireEvent.press(screen.getByText('Cancel'));
    expect(h.cancelFailed).toHaveBeenCalled();
  });
});
