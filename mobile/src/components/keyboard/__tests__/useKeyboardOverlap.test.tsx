import { act, renderHook } from '@testing-library/react-native';
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';
import { useKeyboardOverlap } from '../useKeyboardOverlap';

type Listener = (e?: KeyboardEvent) => void;

function setup(os: 'ios' | 'android', container: { y: number; h: number }, inset = 0) {
  Platform.OS = os;
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 400, height: 900, scale: 2, fontScale: 1 });
  const listeners: Record<string, Listener> = {};
  const addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, cb: Listener) => {
    listeners[name] = cb;
    return { remove: jest.fn() };
  }) as never);
  const ref = { current: { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, container.y, 400, container.h) } as unknown as View };
  const hook = renderHook(() => useKeyboardOverlap(ref, inset));
  const show = (screenY: number, height: number) =>
    act(() => listeners[os === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow']({ endCoordinates: { screenY, height, screenX: 0, width: 400 }, duration: 0 } as KeyboardEvent));
  const hide = () => act(() => listeners[os === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide']({ duration: 0 } as KeyboardEvent));
  return { hook, show, hide, addListener };
}

const originalOS = Platform.OS;
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe('useKeyboardOverlap', () => {
  it('iOS subscribes to the WILL events (padding lands with the keyboard animation)', () => {
    const { addListener } = setup('ios', { y: 103, h: 700 });
    expect(addListener.mock.calls.map((c) => c[0])).toEqual(['keyboardWillChangeFrame', 'keyboardWillHide']);
  });

  it('Android subscribes to the DID events', () => {
    const { addListener } = setup('android', { y: 100, h: 700 });
    expect(addListener.mock.calls.map((c) => c[0])).toEqual(['keyboardDidShow', 'keyboardDidHide']);
  });

  it('short form: reports the exact overlap and clears it when the keyboard hides', () => {
    const { hook, show, hide } = setup('ios', { y: 103, h: 715 }); // ends at 818
    expect(hook.result.current).toEqual({ overlap: 0, keyboardVisible: false });
    show(516, 336);
    expect(hook.result.current).toEqual({ overlap: 818 - 516, keyboardVisible: true });
    hide();
    expect(hook.result.current).toEqual({ overlap: 0, keyboardVisible: false });
  });

  it('measures the container in window coordinates (header offset is included, no keyboardVerticalOffset needed)', () => {
    const { hook, show } = setup('ios', { y: 200, h: 618 }); // taller header → same bottom (818)
    show(516, 336);
    expect(hook.result.current.overlap).toBe(302);
  });

  it('re-measures when the keyboard height changes while visible (e.g. predictive bar / undock)', () => {
    const { hook, show } = setup('ios', { y: 103, h: 715 });
    show(516, 336);
    show(556, 296);
    expect(hook.result.current.overlap).toBe(818 - 556);
  });

  it('Android (edge-to-edge, window not resized): uses the keyboard height when screenY is unhelpful', () => {
    const { hook, show } = setup('android', { y: 100, h: 752 }, 48); // container ends 852
    show(900, 300);
    expect(hook.result.current.overlap).toBe(852 - (900 - 300 - 48));
  });

  it('Android: a window the OS already resized needs no extra padding', () => {
    const { hook, show } = setup('android', { y: 100, h: 452 }, 48); // ends 552 == keyboard top
    show(552, 300);
    expect(hook.result.current).toEqual({ overlap: 0, keyboardVisible: true });
  });

  it('removes its listeners on unmount', () => {
    const remove = jest.fn();
    Platform.OS = 'ios';
    jest.spyOn(Keyboard, 'addListener').mockImplementation((() => ({ remove })) as never);
    const { unmount } = renderHook(() => useKeyboardOverlap({ current: null }, 0));
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
