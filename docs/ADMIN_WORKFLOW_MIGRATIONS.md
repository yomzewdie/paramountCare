# Admin workflow migrations (0007, 0008)

`worker/migrations/0007_clinician_lifecycle.sql` and
`0008_candidates_and_document_review.sql` add the clinician lifecycle record,
the recruiter workflow (On Hold, verification, clearance), New Applicants and
document review. They are forward-only. Nothing in them deletes or rewrites
existing users, applications, sessions, documents or invitations.

## What changes

| | 0007 | 0008 |
|---|---|---|
| New tables | `clinicians` | `document_reviews` |
| New columns | `onboarding_invites.clinician_id` | `clinicians` candidate fields and resume; `onboarding_invites.use_candidate_resume`; `application_documents.superseded_at` |
| Data written | One `clinicians` row per existing account, and one per invited email still not revoked. Invitations and application audit entries are linked to their clinician. | None |
| Rebuilt | `audit_logs`, so `application_id` can be NULL and `clinician_id` can be added. Every row is copied with its original id. | — |

Historical web applications (no account, no session) get no clinician row.
They stay readable as before, and the new workflow actions don't apply to them.

## Applying (UAT first)

1. **Back up.** Note the current D1 Time Travel bookmark, which is the restore point:
   `wrangler d1 time-travel info <database> --env <env>`
2. **Apply, in order:** `wrangler d1 migrations apply <database> --env <env> --remote`.
   Wrangler applies 0007, then 0008, and records each in `d1_migrations` once it succeeds.
3. **Deploy the matching Worker straight after.** An older Worker keeps working
   on the new schema, but it doesn't create or link clinician records, so anyone
   who registers in between appears without one until the new Worker is live.
   Release the mobile build that includes the correction screen at the same
   time. Older app builds can't open post-submission corrections.
4. **Verify** with the read-only checks below.

## Read-only verification

```sql
-- Every account has exactly one clinician (expect 0 rows).
SELECT u.id FROM users u LEFT JOIN clinicians c ON c.user_id = u.id WHERE c.id IS NULL;

-- No email belongs to two clinicians (expect 0 rows).
SELECT email, COUNT(*) FROM clinicians GROUP BY email HAVING COUNT(*) > 1;

-- Audit entries survived the rebuild: compare with the count taken before applying.
SELECT COUNT(*), MAX(id) FROM audit_logs;

-- Invitations without a clinician: expect only ones where every invitation to that email was revoked.
SELECT id, email, revoked_at FROM onboarding_invites WHERE clinician_id IS NULL;
```

## Rollback and recovery

- **Forward-only:** there is no down migration. Both files only add things, and
  0007 also copies the audit table into its new shape.
- **Recovery:** if a migration fails, or the result looks wrong, restore the
  bookmark from step 1:
  `wrangler d1 time-travel restore <database> --env <env> --bookmark <bookmark>`.
  This rewinds the whole database, so anything written after the bookmark is
  lost. Restore before reopening traffic, or export what changed first.
- **Partial failure:** a file that fails isn't recorded in `d1_migrations`.
  Check its state with the queries above before retrying, rather than re-running blindly.
- **Rehearsal:** the files have been tested on a fresh database, on an upgrade
  from 0006 with realistic data (`worker/test/node/migrations.spec.ts`), and
  with Wrangler's local D1 engine. They have never been applied to UAT or
  production.
