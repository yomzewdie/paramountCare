// jest-expo's preset already wires up most React Native/Expo module mocks.
// This file adds the handful this app's own tests need explicit control
// over — real secure storage and real network calls must never run in tests.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// react-native-signature-canvas wraps react-native-webview, a real native
// module (RNCWebViewModule) that doesn't exist in the Jest/Node test
// environment — importing it (even transitively, e.g. via I9Screen ->
// SignaturePad) throws a TurboModuleRegistry invariant violation with no
// mock. Stubbed here, once, globally — matching this file's own existing
// pattern for expo-secure-store/expo-constants — rather than per-test-file,
// since any current or future test that merely IMPORTS I9Screen (not just
// ones that render it) would otherwise fail for an unrelated reason.
jest.mock('react-native-signature-canvas', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockSignatureCanvas = React.forwardRef(function MockSignatureCanvas(_props, ref) {
    React.useImperativeHandle(ref, () => ({
      clearSignature: jest.fn(),
      readSignature: jest.fn(),
      getData: jest.fn(),
      changePenColor: jest.fn(),
      changePenSize: jest.fn(),
      draw: jest.fn(),
      erase: jest.fn(),
      undo: jest.fn(),
      redo: jest.fn(),
      fromData: jest.fn(),
      setDataURL: jest.fn(),
      reinitialize: jest.fn(),
    }));
    return React.createElement(View);
  });
  return {
    __esModule: true,
    default: MockSignatureCanvas,
  };
});

// Fixed, deterministic values standing in for app.config.ts's `extra` block
// — tests never load the real Expo config pipeline, and never talk to a real
// API, so these values are arbitrary but stable placeholders, not secrets.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        appEnv: 'development',
        apiBaseUrl: 'https://test.invalid',
        inviteBaseUrl: 'https://test.invalid/register',
        eas: {},
      },
    },
  },
}));
