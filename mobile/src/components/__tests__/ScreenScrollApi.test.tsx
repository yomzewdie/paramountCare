import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Screen } from '../Screen';
import { useScreenScroll, type KeyboardScrollApi } from '../keyboard/KeyboardScrollContext';

const METRICS = { frame: { x: 0, y: 0, width: 400, height: 900 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const probe: { api: KeyboardScrollApi | null } = { api: null };
function Probe() {
  const api = useScreenScroll();
  useEffect(() => {
    probe.api = api;
  }, [api]);
  return <Text>probe</Text>;
}

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider><Screen><Probe /></Screen></ThemeProvider>
    </SafeAreaProvider>,
  );
}

afterEach(() => jest.restoreAllMocks());

describe('Screen scroll API (signature lock, reveal)', () => {
  it('setScrollLocked disables and re-enables the screen\'s scrolling', () => {
    renderScreen();
    expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(true);
    act(() => probe.api!.setScrollLocked(true));
    expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(false);
    act(() => probe.api!.setScrollLocked(false));
    expect(screen.UNSAFE_getByType(ScrollView).props.scrollEnabled).toBe(true);
  });

  /** Window frames for exactly two objects: the revealed control and the
   * scroll viewport (the Screen also measures its own container — ignored). */
  function setup(target: { y: number; h: number }, viewport: { y: number; h: number }) {
    renderScreen();
    const scroll = screen.UNSAFE_getByType(ScrollView).instance as ScrollView;
    const targetView = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, target.y, 400, target.h) };
    const viewportView = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, viewport.y, 400, viewport.h) };
    jest.spyOn(scroll, 'getNativeScrollRef').mockReturnValue(viewportView as never);
    const spy = jest.spyOn(scroll, 'scrollTo').mockImplementation(() => {});
    spy.mockClear();
    return { spy, targetView };
  }

  it('ensureViewVisible scrolls a revealed control that is below the visible area', () => {
    const { spy, targetView } = setup({ y: 1000, h: 200 }, { y: 0, h: 800 });
    act(() => probe.api!.ensureViewVisible(targetView as never));
    expect(spy).toHaveBeenCalledWith({ y: 424, animated: true }); // 1200 − (800 − 24)
  });

  it('ensureViewVisible does not move the screen when the control is already visible', () => {
    const { spy, targetView } = setup({ y: 300, h: 100 }, { y: 0, h: 800 });
    act(() => probe.api!.ensureViewVisible(targetView as never));
    expect(spy.mock.calls).toEqual([]);
  });
});
