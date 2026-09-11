import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import globals from 'globals';

export default defineConfig([
  ...expoConfig,
  globalIgnores(['dist/**', '.expo/**', 'node_modules/**', 'ios/**', 'android/**', 'expo-env.d.ts']),
  {
    files: ['jest.setup.js', 'jest.config.js', '**/__tests__/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.jest, ...globals.node },
    },
  },
]);
