import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { KeyboardScrollContext } from '../keyboard/KeyboardScrollContext';
import { RevealOnShow } from '../RevealOnShow';

// RevealOnShow scrolls content into view only when a choice REVEALS it.

function Harness({ initial, ensureViewVisible }: { initial: boolean; ensureViewVisible: jest.Mock }) {
  const [shown, setShown] = useState(initial);
  return (
    <KeyboardScrollContext.Provider value={{ ensureFocusedInputVisible: jest.fn(), ensureViewVisible, setScrollLocked: jest.fn() }}>
      <Pressable accessibilityLabel="toggle" onPress={() => setShown((s) => !s)}><Text>toggle</Text></Pressable>
      <RevealOnShow when={shown}>
        <Text>Signature</Text>
      </RevealOnShow>
    </KeyboardScrollContext.Provider>
  );
}

const layout = { nativeEvent: { layout: { x: 0, y: 500, width: 300, height: 200 } } };

beforeEach(() => {
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
});
afterEach(() => jest.restoreAllMocks());

describe('RevealOnShow', () => {
  it('renders nothing while hidden', () => {
    render(<Harness initial={false} ensureViewVisible={jest.fn()} />);
    expect(screen.queryByText('Signature')).toBeNull();
  });

  it('scrolls the newly revealed content into view once it has been laid out', () => {
    const ensureViewVisible = jest.fn();
    render(<Harness initial={false} ensureViewVisible={ensureViewVisible} />);
    fireEvent.press(screen.getByLabelText('toggle'));
    expect(ensureViewVisible).not.toHaveBeenCalled(); // waits for layout
    act(() => fireEvent(screen.getByText('Signature').parent!, 'layout', layout));
    expect(ensureViewVisible).toHaveBeenCalledTimes(1);
  });

  it('does not scroll on first mount (reopening a saved step that already shows it)', () => {
    const ensureViewVisible = jest.fn();
    render(<Harness initial ensureViewVisible={ensureViewVisible} />);
    act(() => fireEvent(screen.getByText('Signature').parent!, 'layout', layout));
    expect(ensureViewVisible).not.toHaveBeenCalled();
  });

  it('later re-layouts of already-revealed content do not scroll again', () => {
    const ensureViewVisible = jest.fn();
    render(<Harness initial={false} ensureViewVisible={ensureViewVisible} />);
    fireEvent.press(screen.getByLabelText('toggle'));
    act(() => fireEvent(screen.getByText('Signature').parent!, 'layout', layout));
    act(() => fireEvent(screen.getByText('Signature').parent!, 'layout', layout));
    expect(ensureViewVisible).toHaveBeenCalledTimes(1);
  });
});

function TargetHarness({ ensureViewVisible }: { ensureViewVisible: jest.Mock }) {
  const [shown, setShown] = useState(false);
  const target = useRef<View>(null);
  return (
    <KeyboardScrollContext.Provider value={{ ensureFocusedInputVisible: jest.fn(), ensureViewVisible, setScrollLocked: jest.fn() }}>
      <Pressable accessibilityLabel="toggle" onPress={() => setShown((s) => !s)}><Text>toggle</Text></Pressable>
      <RevealOnShow when={shown} target={target} testID="section">
        <Text>Long statement</Text>
        <View ref={target} testID="signature"><Text>Signature</Text></View>
      </RevealOnShow>
    </KeyboardScrollContext.Provider>
  );
}

describe('RevealOnShow — target control', () => {
  it('brings the required control (not the whole section) into view', () => {
    const ensureViewVisible = jest.fn();
    render(<TargetHarness ensureViewVisible={ensureViewVisible} />);
    fireEvent.press(screen.getByLabelText('toggle'));
    act(() => fireEvent(screen.getByTestId('section'), 'layout', layout));
    expect(ensureViewVisible).toHaveBeenCalledTimes(1);
    const measured = ensureViewVisible.mock.calls[0][0] as { props?: { testID?: string } };
    expect(measured.props?.testID).toBe('signature');
  });
});
