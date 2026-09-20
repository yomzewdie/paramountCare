#!/usr/bin/env node
// EAS Build lifecycle hook (see mobile/README.md's EAS section and
// docs.expo.dev/build-reference/npm-hooks) — runs ONLY inside an EAS managed
// build, before EAS's own default dependency-install step. Never runs during
// local development, `pnpm install`, or any existing Worker/frontend CI —
// nothing outside EAS's own build runner invokes an npm script named
// "eas-build-pre-install".
//
// Purpose: mobile's real workspace dependency closure is mobile + @pcs/shared
// only (verified by direct dependency-graph inspection and an isolated
// filtered-install test — see the UAT-phase investigation this fix comes
// from). EAS's default install step has no supported way to scope a pnpm
// monorepo install to a subset of workspace packages, so without this hook
// every mobile build also installs worker's entire Cloudflare Workers dev
// toolchain (wrangler/miniflare, which pulls in `sharp`) even though mobile
// never uses any of it — and `sharp` has been failing to build from source on
// the EAS iOS image.
//
// This rewrites ONLY the ephemeral EAS build checkout's own
// pnpm-workspace.yaml, narrowing it to mobile's actual dependency closure
// before EAS's own `pnpm install --frozen-lockfile` runs. The committed
// pnpm-workspace.yaml and pnpm-lock.yaml are never touched — this process
// only ever sees a throwaway checkout inside EAS's build sandbox.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  console.error(`[eas-build-pre-install] ${message}`);
  process.exit(1);
}

const platform = process.env.EAS_BUILD_PLATFORM;
if (platform !== 'ios' && platform !== 'android') {
  fail(
    `expected EAS_BUILD_PLATFORM to be "ios" or "android" (this script only runs inside an EAS managed build), got: ${platform === undefined ? '(unset)' : JSON.stringify(platform)}`,
  );
}

// Locate the monorepo root relative to this script's own file location, not
// whatever cwd EAS happens to invoke it from: mobile/scripts/<this file> ->
// repo root is two directories up.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const workspaceFilePath = resolve(repoRoot, 'pnpm-workspace.yaml');

if (!existsSync(workspaceFilePath)) {
  fail(`expected to find pnpm-workspace.yaml at ${workspaceFilePath}, but it does not exist`);
}

const currentContents = readFileSync(workspaceFilePath, 'utf8');

// Confirm this is genuinely the expected Paramount Care monorepo workspace
// file before overwriting anything — a real signature check, not just "a
// file exists at this path". Every one of these package entries is expected
// in the committed root pnpm-workspace.yaml as of this fix.
const expectedSignatureEntries = ['frontend', 'worker', 'mobile', 'packages/*'];
const missingSignatureEntries = expectedSignatureEntries.filter((entry) => !currentContents.includes(entry));
if (missingSignatureEntries.length > 0) {
  fail(
    `${workspaceFilePath} does not look like the expected Paramount Care monorepo workspace file ` +
      `(missing expected entries: ${missingSignatureEntries.join(', ')}) — refusing to overwrite an unrecognized file`,
  );
}

console.log('EAS mobile build: narrowing pnpm workspace to mobile + packages/shared');

const narrowedContents = ['packages:', '  - mobile', '  - packages/shared', ''].join('\n');
writeFileSync(workspaceFilePath, narrowedContents, 'utf8');

const writtenContents = readFileSync(workspaceFilePath, 'utf8');
console.log('EAS mobile build: pnpm-workspace.yaml now contains:');
console.log(writtenContents);
