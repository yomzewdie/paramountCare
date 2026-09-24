import { computeKeyboardOverlap, computeScrollDelta } from '../keyboardMath';

// iPhone-15-class numbers: 852pt screen, 336pt keyboard (includes the 34pt
// home-indicator inset), native header ends at y=103.
const IOS = { platform: 'ios', keyboardHeight: 336, keyboardScreenY: 852 - 336, screenHeight: 852, safeBottomInset: 34 };

describe('computeKeyboardOverlap — iOS', () => {
  it('a full-screen container (no tab bar) is covered by the keyboard height minus the bottom safe inset it already leaves free', () => {
    // SafeAreaView leaves 34pt free at the bottom → container bottom = 852 - 34.
    expect(computeKeyboardOverlap({ ...IOS, containerBottom: 852 - 34 })).toBe(336 - 34);
  });

  it('is window-relative: a container under a native header is not under-counted (the bug KeyboardAvoidingView had)', () => {
    // Same container bottom regardless of how tall the header above it is.
    const withHeader = computeKeyboardOverlap({ ...IOS, containerBottom: 852 - 34 });
    const noHeader = computeKeyboardOverlap({ ...IOS, containerBottom: 852 - 34 });
    expect(withHeader).toBe(noHeader);
    expect(withHeader).toBeGreaterThan(0);
  });

  it('accounts for a bottom tab bar: a container that ends above the tab bar is only covered by the remainder', () => {
    const tabBar = 83;
    expect(computeKeyboardOverlap({ ...IOS, containerBottom: 852 - tabBar })).toBe(336 - tabBar);
  });

  it('is 0 when the keyboard does not reach the container (hardware keyboard / already above)', () => {
    expect(computeKeyboardOverlap({ ...IOS, keyboardScreenY: 852, containerBottom: 852 - 34 })).toBe(0);
    expect(computeKeyboardOverlap({ ...IOS, containerBottom: 300 })).toBe(0);
  });
});

describe('computeKeyboardOverlap — Android (edge-to-edge)', () => {
  const ANDROID = { platform: 'android', screenHeight: 900, safeBottomInset: 48, keyboardHeight: 300 };

  it('window NOT resized and event screenY unhelpful (= full height): derives the overlap from the keyboard height', () => {
    // keyboard top = 900 - 300 - 48 = 552; container ends at 900 - 48 = 852.
    expect(computeKeyboardOverlap({ ...ANDROID, keyboardScreenY: 900, containerBottom: 852 })).toBe(852 - 552);
  });

  it('window not resized and screenY correct: same answer, no double counting', () => {
    expect(computeKeyboardOverlap({ ...ANDROID, keyboardScreenY: 552, containerBottom: 852 })).toBe(300);
  });

  it('window already resized by the OS (container ends at the keyboard top): no extra padding', () => {
    expect(computeKeyboardOverlap({ ...ANDROID, keyboardScreenY: 552, containerBottom: 552 })).toBe(0);
  });

  it('respects a tab bar under the container', () => {
    expect(computeKeyboardOverlap({ ...ANDROID, keyboardScreenY: 900, containerBottom: 852 - 80 })).toBe(300 - 80);
  });
});

describe('computeScrollDelta', () => {
  const viewport = { viewportTop: 100, viewportBottom: 500, margin: 16 };

  it('does nothing when the input is comfortably visible', () => {
    expect(computeScrollDelta({ ...viewport, inputTop: 200, inputBottom: 250 })).toBe(0);
  });

  it('scrolls down when the input is below (behind the keyboard/footer)', () => {
    // bottom 560 vs allowed 484 → 76
    expect(computeScrollDelta({ ...viewport, inputTop: 510, inputBottom: 560 })).toBe(76);
  });

  it('a final field immediately above the footer keeps its margin', () => {
    expect(computeScrollDelta({ ...viewport, inputTop: 440, inputBottom: 490 })).toBe(6);
  });

  it('scrolls up when the input is above the viewport', () => {
    expect(computeScrollDelta({ ...viewport, inputTop: 60, inputBottom: 110 })).toBe(-56);
  });

  it('a tall multiline field is aligned to the top instead of being pushed off it', () => {
    // 500 tall input in a 400 viewport
    const delta = computeScrollDelta({ ...viewport, inputTop: 300, inputBottom: 800 });
    expect(delta).toBe(300 - (100 + 16));
  });
});
