import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getPacket } from '@pcs/shared';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import AcknowledgementScreen from '../AcknowledgementScreen';
import { useSession } from '../SessionContext';
import type { SessionResponse } from '../sessionApi';

// Physical-UAT regression (JCAHO / TJC Standards Review): the statement sat
// in a fixed-height box with its OWN vertical ScrollView. A swipe starting on
// it scrolled only the box and, on iOS, stopped at the box's bottom instead
// of continuing the page — reaching the checkbox/signature took 2–3 swipes.
// The statement now grows with its content inside the page's single scroll
// surface. Gesture physics can't run under Jest, so these tests pin the
// structure that produces one continuous scroll.

jest.mock('../SessionContext', () => ({ useSession: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), dismissAll: jest.fn(), canDismiss: () => true }),
  useLocalSearchParams: () => ({ stepId: mockStepId }),
  useNavigation: () => ({ addListener: () => () => {}, dispatch: jest.fn() }),
}));
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isConnected: true }) }));

let mockStepId = 'jcaho_review';
const METRICS = { frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }; // small iPhone

function session(): SessionResponse {
  return {
    sessionId: 's', packetId: 'general_rn', packetVersion: 6, firstName: null, lastName: null, email: null, phone: null,
    stepStates: {}, formData: {}, status: 'active', applicationId: null, revision: 1, completionPercent: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as SessionResponse;
}

function renderScreen(saveStep = jest.fn()) {
  (useSession as jest.Mock).mockReturnValue({ session: session(), progress: null, saveStep, status: 'ready', error: null, refresh: jest.fn() });
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider><AcknowledgementScreen /></ThemeProvider>
    </SafeAreaProvider>,
  );
  return saveStep;
}

/** Is `node` (a test instance) inside `ancestor`? */
function isInside(node: { parent: unknown }, ancestor: unknown): boolean {
  for (let n = node.parent as { parent: unknown } | null; n; n = n.parent as { parent: unknown } | null) {
    if (n === ancestor) return true;
  }
  return false;
}

describe.each(['jcaho_review', 'application_statement', 'background_auth', 'health_info_auth', 'patient_bill_of_rights'])(
  'AcknowledgementScreen — one continuous scroll (%s)',
  (stepId) => {
    beforeEach(() => {
      mockStepId = stepId;
      jest.clearAllMocks();
    });

    it('has exactly one vertical scroll surface — the page — with no nested scroller to trap the swipe', () => {
      renderScreen();
      const scrollViews = screen.UNSAFE_getAllByType(ScrollView);
      expect(scrollViews).toHaveLength(1);
      expect(scrollViews[0].props.scrollEnabled).toBe(true);
    });

    it('the whole long statement, the checkbox, and the signature all live in that one page scroll', () => {
      renderScreen();
      const page = screen.UNSAFE_getByType(ScrollView);
      const text = getPacket('general_rn')!.steps.find((s) => s.id === stepId)!.config!.text!;
      const lastParagraph = text.split(/\n\n+/).filter(Boolean).pop()!.trim();
      expect(isInside(screen.getByText(lastParagraph), page)).toBe(true);
      expect(isInside(screen.getByText(/I have read and understood the above/), page)).toBe(true);
      expect(isInside(screen.getByPlaceholderText('Type your full legal name to sign'), page)).toBe(true);
    });

    it('the statement grows with its content and does not capture gestures', () => {
      renderScreen();
      const statement = screen.getByTestId('statement');
      const style = StyleSheet.flatten(statement.props.style);
      expect(style.maxHeight).toBeUndefined();
      expect(style.height).toBeUndefined();
      for (const prop of ['onStartShouldSetResponder', 'onMoveShouldSetResponder', 'onStartShouldSetResponderCapture', 'onMoveShouldSetResponderCapture']) {
        expect(statement.props[prop]).toBeUndefined();
      }
      expect(statement.props.pointerEvents).toBeUndefined();
    });

    it('the pinned Continue / Save Progress bar is outside the scroll area, so the final controls scroll fully above it', () => {
      renderScreen();
      const page = screen.UNSAFE_getByType(ScrollView);
      const footer = screen.getByTestId('screen-footer-pinned');
      expect(isInside(footer, page)).toBe(false);
      expect(isInside(screen.getByText('Continue'), page)).toBe(false);
      // Bottom breathing room after the signature / validation messages.
      expect(StyleSheet.flatten(page.props.contentContainerStyle).padding).toBeGreaterThan(0);
    });

    it('completion is unchanged: Continue without acknowledging and signing saves nothing and shows both errors', async () => {
      const saveStep = renderScreen();
      fireEvent.press(screen.getByText('Continue'));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(saveStep).not.toHaveBeenCalled();
      expect(screen.getByText('You must acknowledge this item before continuing')).toBeTruthy();
      expect(screen.getByText('Your typed signature is required')).toBeTruthy();
    });
  },
);
