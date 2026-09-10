// Minimal, non-type-aware flat config — deliberately lightweight (no
// project-service/type-checked rules) so lint stays fast and this isn't a
// large formatting/lint migration for an existing codebase.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'worker-configuration.d.ts',
      // Required declaration-merging boilerplate for @cloudflare/vitest-pool-workers
      // (see https://developers.cloudflare.com/workers/testing/vitest-integration/)
      // — the empty interface body is the documented pattern, not dead code.
      'test/env.d.ts',
      '.wrangler/**',
      'node_modules/**',
    ],
  },
);
