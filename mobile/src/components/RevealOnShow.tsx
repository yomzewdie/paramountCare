import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useScreenScroll } from './keyboard/KeyboardScrollContext';

/**
 * Conditional content (rendered only while `when` is true) that, when a
 * choice REVEALS it — `when` going false → true, e.g. a Yes/No answer that
 * brings in a signature, an upload, or a declination acknowledgment — is
 * scrolled into a comfortable visible position inside the enclosing Screen.
 *
 *  - `target` is the required control the applicant must act on next (the
 *    signature/name entry, the upload). It — not the whole section — is
 *    brought into view, by the smallest scroll that shows it fully: a tall
 *    section (a long declination statement) can never leave the signature
 *    below the fold, and everything above the control stays as visible as
 *    the screen allows. Without a target, the whole section is used.
 *  - Waits for the revealed content to be laid out before measuring.
 *  - Does nothing when the control is already fully visible (no jump).
 *  - Scrolls once per reveal: later re-layouts (validation messages,
 *    typing, signing) never scroll again.
 *  - Does nothing on first mount (reopening a saved step that already shows
 *    it) — only an actual reveal scrolls.
 * Purely presentational: it never changes what the form stores or requires.
 */
export function RevealOnShow({
  when,
  children,
  style,
  onLayout,
  target,
  testID,
}: {
  when: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Forwarded — e.g. a screen tracking this section's offset for scroll-to-error. */
  onLayout?: (e: LayoutChangeEvent) => void;
  /** The required control inside this section to bring into view. */
  target?: RefObject<View | null>;
  testID?: string;
}) {
  const { ensureViewVisible } = useScreenScroll();
  const ref = useRef<View>(null);
  const previous = useRef(when);
  const pending = useRef(false);

  function handleLayout(e: LayoutChangeEvent): void {
    onLayout?.(e);
    if (!pending.current) return;
    pending.current = false;
    // One frame later the newly mounted content has its final position.
    requestAnimationFrame(() => {
      const view = target?.current ?? ref.current;
      if (view) ensureViewVisible(view);
    });
  }

  useLayoutEffect(() => {
    if (when && !previous.current) pending.current = true;
    previous.current = when;
  }, [when]);

  if (!when) return null;
  return (
    <View ref={ref} style={style} onLayout={handleLayout} testID={testID}>
      {children}
    </View>
  );
}
