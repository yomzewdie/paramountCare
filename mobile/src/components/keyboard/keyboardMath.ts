// Pure geometry for keyboard-safe layout. Everything here is in WINDOW
// coordinates (what `measureInWindow` and keyboard events report), never
// parent-relative — that mismatch is exactly what made React Native's
// KeyboardAvoidingView under-pad screens that sit below a native header or
// above a bottom tab bar.

export interface KeyboardOverlapInput {
  platform: string;
  /** Window-Y of the bottom edge of the keyboard-avoiding container. */
  containerBottom: number;
  /** Window-Y of the top edge of the keyboard (event.endCoordinates.screenY). */
  keyboardScreenY: number;
  /** Keyboard height as reported by the event. */
  keyboardHeight: number;
  /** Full physical screen height (includes system bars). */
  screenHeight: number;
  /** System-bar (navigation bar) bottom inset. */
  safeBottomInset: number;
}

/**
 * How many px of the container's bottom the keyboard covers (0 if none).
 *
 * iOS: the event's screenY is authoritative.
 *
 * Android: Expo SDK 57 / Android 16 force edge-to-edge, in which the OS no
 * longer resizes the window for the keyboard, and the screenY React Native
 * reports depends on the soft-input mode. So a second estimate is derived
 * from the keyboard height (keyboard top = screen height − IME inset, where
 * IME inset = reported height + navigation-bar inset) and the larger of the
 * two is used. If the window WAS resized (older/opt-out behavior) the
 * container's bottom is already above the keyboard, both estimates are ~0,
 * and nothing is double-counted.
 */
export function computeKeyboardOverlap(i: KeyboardOverlapInput): number {
  const fromScreenY = i.containerBottom - i.keyboardScreenY;
  if (i.platform !== 'android') return Math.max(fromScreenY, 0);
  const keyboardTop = i.screenHeight - i.keyboardHeight - i.safeBottomInset;
  const fromHeight = i.containerBottom - keyboardTop;
  return Math.max(fromScreenY, fromHeight, 0);
}

export interface ScrollDeltaInput {
  inputTop: number;
  inputBottom: number;
  viewportTop: number;
  viewportBottom: number;
  /** Breathing room kept between the input and the viewport edge. */
  margin: number;
}

/**
 * How far to scroll (positive = further down) so the focused input sits fully
 * inside the visible scroll viewport (which already excludes the keyboard and
 * the pinned footer). 0 when it is already visible. An input taller than the
 * viewport is aligned to the top instead of being pushed off it.
 */
export function computeScrollDelta(i: ScrollDeltaInput): number {
  const minTop = i.viewportTop + i.margin;
  const maxBottom = i.viewportBottom - i.margin;

  if (i.inputTop < minTop) return i.inputTop - minTop;
  if (i.inputBottom > maxBottom) return Math.min(i.inputBottom - maxBottom, i.inputTop - minTop);
  return 0;
}
