// Moved to packages/shared/src/validation.ts (see docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-010) so the Cloudflare Worker and the future mobile app can share the
// same validation rules. Re-exported here so existing `@/lib/validation`
// imports across the app keep working unchanged.
export * from '@pcs/shared/validation';
