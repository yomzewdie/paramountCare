import { defineConfig } from 'vitest/config';

// A second, plain-Node Vitest project — separate from vitest.config.mts's
// @cloudflare/vitest-pool-workers pool. Exists ONLY for tests against
// services/w4pdf.ts's generateW4Pdf(): that function has zero Cloudflare-
// specific dependencies (pure pdf-lib + fontkit), and verifying its output
// PDF actually contains the expected text (the applicant's full SSN, in
// particular — a hard requirement, not a nice-to-have) needs a real text-
// extraction library (pdfjs-dist) that has no proven, supported story
// inside the Workers-pool sandbox, which has no real filesystem and a
// restricted Node surface even under nodejs_compat. Plain Node has neither
// limitation and is what the rest of the monorepo already runs the same
// PDF tooling under (see frontend's own pdfjs-dist devDependency).
//
// Test files here MUST NOT import D1/R2/Workers bindings or `cloudflare:test`
// — that belongs in the main vitest.config.mts suite instead.
export default defineConfig({
  test: {
    include: ['test/node/**/*.spec.ts'],
    environment: 'node',
  },
});
