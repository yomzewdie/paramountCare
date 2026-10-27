import { createContext, useContext } from 'react';
import type { View } from 'react-native';

export interface KeyboardScrollApi {
  /** Call when a text input gains focus or grows (multiline): scrolls the
   * focused input fully into the visible area above the keyboard/footer. */
  ensureFocusedInputVisible: () => void;
  /** Scrolls `view` into the visible area (above the keyboard/footer) only
   * if it is not already fully visible — e.g. a control just revealed by a
   * Yes/No choice. Never jumps when it's already in view. */
  ensureViewVisible: (view: View) => void;
  /** Freezes the screen's own scrolling (true) while a gesture inside it —
   * a signature stroke — must not be taken over by the scroll view. */
  setScrollLocked: (locked: boolean) => void;
}

const NOOP: KeyboardScrollApi = { ensureFocusedInputVisible: () => {}, ensureViewVisible: () => {}, setScrollLocked: () => {} };

export const KeyboardScrollContext = createContext<KeyboardScrollApi>(NOOP);

/** Outside a `Screen` (or in isolated tests) this is a harmless no-op. */
export function useKeyboardScroll(): KeyboardScrollApi {
  return useContext(KeyboardScrollContext);
}

/** The same per-screen scroll API, for non-keyboard uses (reveal, scroll lock). */
export const useScreenScroll = useKeyboardScroll;
