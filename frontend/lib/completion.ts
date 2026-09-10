// Moved to packages/shared/src/completion.ts (see docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-010) so the Cloudflare Worker and the future mobile app can share the
// same completion calculators. Re-exported here so existing `@/lib/completion`
// imports across the app keep working unchanged.
export * from '@pcs/shared/completion';
