import { createContext, useContext } from 'react';

export interface KeyboardScrollApi {
  /** Call when a text input gains focus or grows (multiline): scrolls the
   * focused input fully into the visible area above the keyboard/footer. */
  ensureFocusedInputVisible: () => void;
}

const NOOP: KeyboardScrollApi = { ensureFocusedInputVisible: () => {} };

export const KeyboardScrollContext = createContext<KeyboardScrollApi>(NOOP);

/** Outside a `Screen` (or in isolated tests) this is a harmless no-op. */
export function useKeyboardScroll(): KeyboardScrollApi {
  return useContext(KeyboardScrollContext);
}
