// Moved to packages/shared/src/onboarding.ts (see docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-010) so the Cloudflare Worker and the future mobile app can share the
// same domain types. Re-exported here so existing `@/types/onboarding`
// imports across the app keep working unchanged.
export * from '@pcs/shared/onboarding';
