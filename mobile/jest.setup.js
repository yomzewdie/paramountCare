// jest-expo's preset already wires up most React Native/Expo module mocks.
// This file adds the handful this app's own tests need explicit control
// over — real secure storage and real network calls must never run in tests.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

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
