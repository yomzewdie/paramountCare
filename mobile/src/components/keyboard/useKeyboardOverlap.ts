import { useEffect, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent, type View } from 'react-native';
import { computeKeyboardOverlap } from './keyboardMath';

// Same update-only animation React Native's own KeyboardAvoidingView uses, so
// the padding change tracks the keyboard's own slide.
function animateLikeKeyboard(e?: KeyboardEvent): void {
  if (Platform.OS !== 'ios' || !e?.duration) return;
  const duration = e.duration > 10 ? e.duration : 10;
  LayoutAnimation.configureNext({
    duration,
    update: { duration, type: LayoutAnimation.Types[e.easing as keyof typeof LayoutAnimation.Types] ?? 'keyboard' },
  });
}

export interface KeyboardOverlapState {
  /** px of the container's bottom currently covered by the keyboard. */
  overlap: number;
  keyboardVisible: boolean;
}

/**
 * Tracks the software keyboard and reports how much of `containerRef`'s
 * bottom it covers, measured in window coordinates at event time.
 *
 * Unlike KeyboardAvoidingView this needs no `keyboardVerticalOffset`: the
 * container is measured where it actually is, so a native header above it, a
 * bottom tab bar or safe-area inset below it, or a window that the OS already
 * resized are all accounted for without any per-screen constant.
 */
export function useKeyboardOverlap(containerRef: RefObject<View | null>, safeBottomInset: number): KeyboardOverlapState {
  const [state, setState] = useState<KeyboardOverlapState>({ overlap: 0, keyboardVisible: false });

  useEffect(() => {
    const ios = Platform.OS === 'ios';

    const onShow = (e: KeyboardEvent) => {
      const node = containerRef.current;
      if (!node) return;
      node.measureInWindow((_x, y, _w, h) => {
        const overlap = computeKeyboardOverlap({
          platform: Platform.OS,
          containerBottom: y + h,
          keyboardScreenY: e.endCoordinates.screenY,
          keyboardHeight: e.endCoordinates.height,
          screenHeight: Dimensions.get('screen').height,
          safeBottomInset,
        });
        animateLikeKeyboard(e);
        setState((prev) => (prev.overlap === overlap && prev.keyboardVisible ? prev : { overlap, keyboardVisible: true }));
      });
    };

    const onHide = (e?: KeyboardEvent) => {
      animateLikeKeyboard(e);
      setState({ overlap: 0, keyboardVisible: false });
    };

    // iOS: "WillChangeFrame" fires before the animation with the FINAL frame
    // (and again on undock/predictive-bar height changes). Android only
    // reports after the fact ("Did*").
    const subs = ios
      ? [Keyboard.addListener('keyboardWillChangeFrame', onShow), Keyboard.addListener('keyboardWillHide', onHide)]
      : [Keyboard.addListener('keyboardDidShow', onShow), Keyboard.addListener('keyboardDidHide', onHide)];

    return () => subs.forEach((s) => s.remove());
  }, [containerRef, safeBottomInset]);

  return state;
}
