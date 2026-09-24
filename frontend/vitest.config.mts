import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Plain-Node unit tests for the admin portal's logic and server-rendered
// components (rendered with react-dom/server — no browser/jsdom needed).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
