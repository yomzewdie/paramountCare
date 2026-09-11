/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  // Deliberately NOT overriding transformIgnorePatterns — jest-expo's own
  // preset (via @react-native/jest-preset) already ships the correct
  // pattern for whatever RN/Expo package set is actually installed; a
  // hand-copied override here silently replaces rather than extends it and
  // will drift out of sync with real dependency versions.
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // This is a foundation-milestone test suite for auth/token/error-mapping
  // logic, not a full-app rendering suite — screens are deliberately not
  // snapshot-tested here (brittle, low-value per the M3 instructions).
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
};
