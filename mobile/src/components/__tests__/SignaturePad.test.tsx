import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { KeyboardScrollContext } from '../keyboard/KeyboardScrollContext';
import { SignaturePad, MIN_DISTANCE } from '../SignaturePad';

// Captures what SignaturePad hands the WebView-based canvas, and lets a test
// fire the canvas's own callbacks (stroke begin/end, image ready, empty).
const mockCanvas = {
  props: {} as Record<string, unknown>,
  clearSignature: jest.fn(),
  readSignature: jest.fn(),
};

// jest.mock factories can't reference imports, hence require(); recording
// the props on a module-level object is the point of this test double.
/* eslint-disable @typescript-eslint/no-require-imports, react-hooks/immutability */
jest.mock('react-native-signature-canvas', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = React.forwardRef(function MockSignatureCanvas(props: Record<string, unknown>, ref: unknown) {
    mockCanvas.props = props;
    React.useImperativeHandle(ref, () => ({ clearSignature: mockCanvas.clearSignature, readSignature: mockCanvas.readSignature }));
    return React.createElement(View);
  });
  return { __esModule: true, default: Mock };
});
/* eslint-enable @typescript-eslint/no-require-imports, react-hooks/immutability */

const PNG_A = 'data:image/png;base64,AAAA';
const PNG_B = 'data:image/png;base64,BBBB';

function Harness({ initial = '', setScrollLocked = jest.fn() }: { initial?: string; setScrollLocked?: jest.Mock }) {
  const [value, setValue] = useState(initial);
  return (
    <ThemeProvider>
      <KeyboardScrollContext.Provider value={{ ensureFocusedInputVisible: jest.fn(), ensureViewVisible: jest.fn(), setScrollLocked }}>
        <SignaturePad value={value} onChange={setValue} onClear={() => setValue('')} />
        {/* lets a test replace the value from "outside" (e.g. discard changes) */}
        <Replace onPress={() => setValue(PNG_B)} />
      </KeyboardScrollContext.Provider>
    </ThemeProvider>
  );
}

function Replace({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="replace" onPress={onPress}><Text>replace</Text></Pressable>;
}

beforeEach(() => {
  mockCanvas.clearSignature.mockClear();
  mockCanvas.readSignature.mockClear();
});

function renderPad(props: { initial?: string; setScrollLocked?: jest.Mock } = {}) {
  const setScrollLocked = props.setScrollLocked ?? jest.fn();
  const onChange = jest.fn();
  const onClear = jest.fn();
  const utils = render(
    <ThemeProvider>
      <KeyboardScrollContext.Provider value={{ ensureFocusedInputVisible: jest.fn(), ensureViewVisible: jest.fn(), setScrollLocked }}>
        <SignaturePad value={props.initial ?? ''} onChange={onChange} onClear={onClear} />
      </KeyboardScrollContext.Provider>
    </ThemeProvider>,
  );
  return { ...utils, onChange, onClear, setScrollLocked };
}

describe('SignaturePad', () => {
  it('keeps the existing PNG data-URL output format (PDF compatibility)', () => {
    renderPad();
    expect(mockCanvas.props.imageType).toBe('image/png');
    expect(mockCanvas.props.trimWhitespace).toBe(true);
  });

  it('captures fine touch movement (smooth slow strokes) instead of the 5px default', () => {
    renderPad();
    expect(mockCanvas.props.minDistance).toBe(MIN_DISTANCE);
    expect(MIN_DISTANCE).toBeLessThan(5);
  });

  it('locks the screen\'s scrolling for the duration of a stroke', () => {
    const { setScrollLocked } = renderPad();
    act(() => (mockCanvas.props.onBegin as () => void)());
    expect(setScrollLocked).toHaveBeenLastCalledWith(true);
    act(() => (mockCanvas.props.onEnd as () => void)());
    expect(setScrollLocked).toHaveBeenLastCalledWith(false);
  });

  it('reads the image once per finished stroke (not per touch point) and reports it', () => {
    const { onChange } = renderPad();
    act(() => (mockCanvas.props.onBegin as () => void)());
    expect(mockCanvas.readSignature).not.toHaveBeenCalled();
    act(() => (mockCanvas.props.onEnd as () => void)());
    expect(mockCanvas.readSignature).toHaveBeenCalledTimes(1);
    act(() => (mockCanvas.props.onOK as (u: string) => void)(PNG_A));
    expect(onChange).toHaveBeenCalledWith(PNG_A);
  });

  it('never feeds its own output back into the canvas (no re-rasterizing between strokes)', () => {
    render(<Harness />);
    expect(mockCanvas.props.dataURL).toBeUndefined();
    act(() => (mockCanvas.props.onOK as (u: string) => void)(PNG_A));
    // The parent now holds PNG_A, but the canvas is not reloaded with it.
    expect(mockCanvas.props.dataURL).toBeUndefined();
  });

  it('restores a previously saved signature on open', () => {
    renderPad({ initial: PNG_A });
    expect(mockCanvas.props.dataURL).toBe(PNG_A);
  });

  it('loads a value that came from outside (e.g. "discard my changes")', () => {
    render(<Harness initial={PNG_A} />);
    fireEvent.press(screen.getByLabelText('replace'));
    expect(mockCanvas.props.dataURL).toBe(PNG_B);
  });

  it('Clear clears the canvas and the stored value', () => {
    const { onClear } = renderPad({ initial: PNG_A });
    fireEvent.press(screen.getByLabelText('Clear signature'));
    expect(mockCanvas.clearSignature).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('an empty canvas reports "" and never leaves scrolling locked', () => {
    const { onChange, setScrollLocked } = renderPad();
    act(() => (mockCanvas.props.onBegin as () => void)());
    act(() => (mockCanvas.props.onEmpty as () => void)());
    expect(onChange).toHaveBeenCalledWith('');
    expect(setScrollLocked).toHaveBeenLastCalledWith(false);
  });

  it('unlocks scrolling if the pad unmounts mid-stroke', () => {
    const { setScrollLocked, unmount } = renderPad();
    act(() => (mockCanvas.props.onBegin as () => void)());
    unmount();
    expect(setScrollLocked).toHaveBeenLastCalledWith(false);
  });
});
