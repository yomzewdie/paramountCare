import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createRef } from 'react';
import { Dimensions, Keyboard, Platform, ScrollView, Text, TextInput, View, type KeyboardEvent } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Screen } from '../Screen';
import { TextField } from '../TextField';
import { Button } from '../Button';

// Screen is THE shared layout for every app screen, so its keyboard
// behavior is tested once here (rather than per screen). The keyboard math
// itself is covered in keyboard/__tests__; this file proves the wiring.

// Scroll margin = theme.spacing.lg (see Screen.tsx).
const MARGIN = 24;
const METRICS = { frame: { x: 0, y: 0, width: 400, height: 900 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const originalOS = Platform.OS;

type Listener = (e?: KeyboardEvent) => void;
let listeners: Record<string, Listener>;

function stubKeyboard(os: 'ios' | 'android') {
  Platform.OS = os;
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 400, height: 900, scale: 2, fontScale: 1 });
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, cb: Listener) => {
    listeners[name] = cb;
    return { remove: jest.fn() };
  }) as never);
}

function stubContainerFrame(y: number, h: number) {
  // Every View reports the same window frame; only the container's matters here.
  jest.spyOn(View.prototype as unknown as { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void }, 'measureInWindow').mockImplementation((cb) => cb(0, y, 400, h));
}

function showKeyboard(os: 'ios' | 'android', screenY: number, height: number) {
  act(() => {
    listeners[os === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow']({ endCoordinates: { screenY, height, screenX: 0, width: 400 }, duration: 0 } as KeyboardEvent);
  });
}

// The Jest ScrollView mock shares one scrollTo mock across instances, so
// clear it after render to count only this test's calls.
function spyScrollTo(ref: { current: ScrollView | null }) {
  const spy = jest.spyOn(ref.current!, 'scrollTo');
  spy.mockClear();
  return spy;
}

function renderScreen(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>,
  );
}

afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe('Screen — scroll/tap/dismiss configuration (inherited by every screen)', () => {
  it('taps reach children on the FIRST tap while the keyboard is open (keyboardShouldPersistTaps="handled")', () => {
    stubKeyboard('ios');
    renderScreen(<Screen><Text>form</Text></Screen>);
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('iOS: dragging the form dismisses the keyboard interactively', () => {
    stubKeyboard('ios');
    renderScreen(<Screen><Text>form</Text></Screen>);
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('interactive');
  });

  it('Android: dragging the form dismisses the keyboard', () => {
    stubKeyboard('android');
    renderScreen(<Screen><Text>form</Text></Screen>);
    expect(screen.UNSAFE_getByType(ScrollView).props.keyboardDismissMode).toBe('on-drag');
  });

  it('a non-scrolling screen (no inputs) still renders and takes no keyboard-scroll props', () => {
    stubKeyboard('ios');
    renderScreen(<Screen scroll={false}><Text>static</Text></Screen>);
    expect(screen.getByText('static')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(ScrollView)).toBeNull();
  });
});

describe.each(['ios', 'android'] as const)('Screen — keyboard-safe layout (%s)', (os) => {
  it('short form: the pinned footer is lifted above the keyboard by the measured overlap', () => {
    stubKeyboard(os);
    stubContainerFrame(103, 715); // window bottom 818
    renderScreen(<Screen footer={<Button label="Continue" onPress={() => {}} />}><Text>short form</Text></Screen>);

    const container = screen.getByTestId('screen-keyboard-container');
    expect(container.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ paddingBottom: 0 })]));

    showKeyboard(os, os === 'ios' ? 516 : 900, 336);
    // iOS: 818 - 516. Android (window not resized, screenY unhelpful): 818 - (900 - 336 - 34).
    const expected = os === 'ios' ? 302 : 818 - (900 - 336 - 34);
    expect(screen.getByTestId('screen-keyboard-container').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: expected })]),
    );
  });

  it('padding is removed when the keyboard hides (footer returns to the bottom / tab-bar area)', () => {
    stubKeyboard(os);
    stubContainerFrame(103, 715);
    renderScreen(<Screen footer={<Button label="Continue" onPress={() => {}} />}><Text>form</Text></Screen>);
    showKeyboard(os, 516, 336);
    act(() => listeners[os === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide']({ duration: 0 } as KeyboardEvent));
    expect(screen.getByTestId('screen-keyboard-container').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 0 })]),
    );
  });

  it('respects a bottom tab bar: a container that already ends above it gets only the remaining overlap', () => {
    stubKeyboard(os);
    stubContainerFrame(103, 662); // ends 765 (83pt tab bar under it)
    renderScreen(<Screen><Text>form</Text></Screen>);
    showKeyboard(os, os === 'ios' ? 516 : 900, 336);
    const expected = os === 'ios' ? 765 - 516 : 765 - (900 - 336 - 34);
    expect(screen.getByTestId('screen-keyboard-container').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: expected })]),
    );
  });

  it('Continue works on the first tap while the keyboard is open (footer is outside the scroll view and untouched by keyboard handling)', () => {
    stubKeyboard(os);
    stubContainerFrame(103, 715);
    const onContinue = jest.fn();
    renderScreen(<Screen footer={<Button label="Continue" onPress={onContinue} />}><Text>form</Text></Screen>);
    showKeyboard(os, 516, 336);

    fireEvent.press(screen.getByText('Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);

    // Structural guarantee behind "first tap": the footer is NOT inside the
    // ScrollView (whose default would swallow the first tap to dismiss).
    const scroll = screen.UNSAFE_getByType(ScrollView);
    expect(scroll.findAllByProps({ children: 'Continue' }).length).toBe(0);
  });
});

describe('Screen — focused input is scrolled into view', () => {
  function focusedInputAt(top: number, height: number) {
    const input = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, top, 300, height) };
    jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockReturnValue(input as never);
  }
  function stubViewport(top: number, height: number) {
    jest
      .spyOn(ScrollView.prototype as unknown as { getNativeScrollRef: () => unknown }, 'getNativeScrollRef')
      .mockReturnValue({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, top, 400, height) });
  }

  it('scrolls a field that ended up behind the keyboard/footer up into the visible viewport when the keyboard opens', async () => {
    stubKeyboard('ios');
    stubContainerFrame(103, 715);
    stubViewport(103, 300); // visible viewport 103..403 after padding + footer
    focusedInputAt(600, 48); // hidden below
    const ref = createRef<ScrollView>();
    renderScreen(<Screen ref={ref as never}><TextField label="Last field" /></Screen>);
    const scrollTo = spyScrollTo(ref);

    showKeyboard('ios', 516, 336);
    // input bottom 648 must end up MARGIN above the viewport bottom (403)
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ y: 648 - (403 - MARGIN), animated: true }));
  });

  it('focusing a field while the keyboard is already open (Next) scrolls it into view', () => {
    stubKeyboard('ios');
    stubContainerFrame(103, 715);
    stubViewport(103, 300);
    focusedInputAt(103 + 400, 48);
    const ref = createRef<ScrollView>();
    renderScreen(<Screen ref={ref as never}><TextField label="Field" placeholder="p" /></Screen>);
    const scrollTo = spyScrollTo(ref);

    fireEvent(screen.getByPlaceholderText('p'), 'focus');
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not scroll when the focused field is already visible', () => {
    stubKeyboard('ios');
    stubContainerFrame(103, 715);
    stubViewport(103, 300);
    focusedInputAt(200, 48);
    const ref = createRef<ScrollView>();
    renderScreen(<Screen ref={ref as never}><TextField label="Field" placeholder="p" /></Screen>);
    const scrollTo = spyScrollTo(ref);

    fireEvent(screen.getByPlaceholderText('p'), 'focus');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a multiline field near the bottom is kept visible as it grows', () => {
    stubKeyboard('ios');
    stubContainerFrame(103, 715);
    stubViewport(103, 300);
    focusedInputAt(300, 150); // bottom 450 > 379 allowed
    const ref = createRef<ScrollView>();
    renderScreen(<Screen ref={ref as never}><TextField label="Comments" placeholder="c" multiline /></Screen>);
    const scrollTo = spyScrollTo(ref);

    fireEvent(screen.getByPlaceholderText('c'), 'contentSizeChange', { nativeEvent: { contentSize: { width: 300, height: 150 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 450 - (403 - MARGIN), animated: true });
  });

  it('a single-line field growing does not trigger scrolling', () => {
    stubKeyboard('ios');
    stubContainerFrame(103, 715);
    stubViewport(103, 300);
    focusedInputAt(600, 48);
    const ref = createRef<ScrollView>();
    renderScreen(<Screen ref={ref as never}><TextField label="Name" placeholder="n" /></Screen>);
    const scrollTo = spyScrollTo(ref);

    fireEvent(screen.getByPlaceholderText('n'), 'contentSizeChange', { nativeEvent: { contentSize: { width: 300, height: 48 } } });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
