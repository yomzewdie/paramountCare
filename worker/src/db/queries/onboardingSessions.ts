export interface OnboardingSessionRow {
  id: number;
  session_id: string;
  packet_id: string;
  packet_version: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  step_states_json: string;
  form_data_json: string;
  status: string;
  application_id: string | null;
  // Nullable at the DB level for a pre-existing-row compatibility reason
  // documented in migrations/0003_mobile_auth_and_sessions.sql — every
  // session the application creates always sets this. There is no anonymous
  // session and no claim transition; ownership is fixed at creation.
  user_id: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface InsertSessionParams {
  sessionId: string;
  packetId: string;
  packetVersion: number;
  /** Always the authenticated applicant creating the session — required, not
   * optional. Callers must derive this from the verified access token, never
   * from client-supplied input (see routes/sessions.ts). */
  userId: number;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  // D1's actual error shape for this, confirmed empirically against the
  // idx_sessions_user_id_unique partial index (migrations/0005):
  // `D1_ERROR: UNIQUE constraint failed: onboarding_sessions.user_id: SQLITE_CONSTRAINT`.
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

export type InsertSessionResult =
  | { created: true; session: OnboardingSessionRow }
  | { created: false; session: OnboardingSessionRow };

/**
 * Race-safe get-or-create (ADR-018 §2): two devices calling this
 * concurrently for the same user_id cannot both succeed — the database's
 * `idx_sessions_user_id_unique` partial unique index (migrations/0005) is
 * the actual authority, not a read-then-write check here. Whichever INSERT
 * the database lets through wins (`created: true`); the other's INSERT
 * throws a UNIQUE constraint violation, which is caught and turned into a
 * lookup of the row that just won — that applicant's real, valid,
 * authoritative session — rather than an error surfaced to the caller.
 * Never a 500, never a duplicate row, never a caller left without a usable
 * session.
 */
export async function insertSessionOrGetExisting(
  db: D1Database,
  p: InsertSessionParams,
): Promise<InsertSessionResult> {
  try {
    const result = await db
      .prepare(
        `INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, user_id)
         VALUES (?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(p.sessionId, p.packetId, p.packetVersion, p.userId)
      .first<OnboardingSessionRow>();

    if (!result) throw new Error('insertSessionOrGetExisting: RETURNING clause produced no row');
    return { created: true, session: result };
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;

    // Look up by user_id alone (not scoped to status) — the constraint
    // itself isn't scoped to 'active' sessions either (see migrations/0005's
    // own comment on why), so this is what's actually guaranteed to find
    // the row that won the race.
    const existing = await findSessionByUserId(db, p.userId);
    // Should be unreachable — the constraint violation itself proves a row
    // exists — but never mask the original DB error with a misleading
    // "session not found" if this ever somehow doesn't find one.
    if (!existing) throw err;
    return { created: false, session: existing };
  }
}

export async function findSessionById(
  db: D1Database,
  sessionId: string,
): Promise<OnboardingSessionRow | null> {
  return db
    .prepare('SELECT * FROM onboarding_sessions WHERE session_id = ? LIMIT 1')
    .bind(sessionId)
    .first<OnboardingSessionRow>();
}

/** Any session belonging to this user, regardless of status — used only to
 * recover the winning row after a UNIQUE constraint violation above; the
 * ordinary "resume" read path is findActiveSessionForUser below. */
export async function findSessionByUserId(
  db: D1Database,
  userId: number,
): Promise<OnboardingSessionRow | null> {
  return db
    .prepare('SELECT * FROM onboarding_sessions WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<OnboardingSessionRow>();
}

/** The applicant's most recently updated non-terminal session — the natural
 * "resume onboarding" entry point after logging in on a new device. */
export async function findActiveSessionForUser(
  db: D1Database,
  userId: number,
): Promise<OnboardingSessionRow | null> {
  return db
    .prepare(
      `SELECT * FROM onboarding_sessions
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .bind(userId)
    .first<OnboardingSessionRow>();
}

export interface UpdateSessionWithRevisionParams {
  sessionId: string;
  expectedRevision: number;
  /** The authenticated caller's own id — included directly in the UPDATE's
   * WHERE clause (not just checked beforehand) so the write itself can never
   * apply to a session it doesn't own, even in the event of a bug elsewhere
   * in the request-handling path. See routes/sessions.ts. */
  ownerUserId: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  stepStatesJson?: string;
  formDataJson?: string;
  status?: string;
  applicationId?: string;
}

export type UpdateSessionResult =
  | { ok: true; session: OnboardingSessionRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; current: OnboardingSessionRow };

/**
 * Optimistic-concurrency update: succeeds only if `expectedRevision` still
 * matches the row's current revision AND `ownerUserId` still matches the
 * row's user_id, at the moment of the write. This is a single conditioned
 * UPDATE (WHERE session_id = ? AND revision = ? AND user_id = ?), so there is
 * no read-then-write race window between checking authorization and applying
 * the change — D1/SQLite evaluates the WHERE clause and applies the SET
 * atomically within one statement.
 *
 * Callers (routes/sessions.ts) are expected to have already confirmed
 * ownership via a prior read before calling this, so in practice a 0-row
 * result here always means a stale revision, not a wrong owner — the
 * ownership clause is defense-in-depth, not the primary authorization check.
 *
 * On success, revision is incremented and the fresh row is returned.
 * On a stale `expectedRevision`, nothing is written — the caller returns 409
 * with the current state so the client can reconcile, per
 * docs/ARCHITECTURE_DECISION_RECORDS.md ADR-011. No last-write-wins path
 * exists anywhere in this function.
 */
export async function updateSessionWithRevision(
  db: D1Database,
  p: UpdateSessionWithRevisionParams,
): Promise<UpdateSessionResult> {
  const sets: string[] = ['updated_at = datetime(\'now\')', 'revision = revision + 1'];
  const vals: (string | number | null)[] = [];

  if (p.firstName      !== undefined) { sets.push('first_name = ?');       vals.push(p.firstName); }
  if (p.lastName       !== undefined) { sets.push('last_name = ?');        vals.push(p.lastName); }
  if (p.email          !== undefined) { sets.push('email = ?');            vals.push(p.email); }
  if (p.phone          !== undefined) { sets.push('phone = ?');            vals.push(p.phone); }
  if (p.stepStatesJson !== undefined) { sets.push('step_states_json = ?'); vals.push(p.stepStatesJson); }
  if (p.formDataJson   !== undefined) { sets.push('form_data_json = ?');   vals.push(p.formDataJson); }
  if (p.status         !== undefined) { sets.push('status = ?');           vals.push(p.status); }
  if (p.applicationId  !== undefined) { sets.push('application_id = ?');   vals.push(p.applicationId); }

  const result = await db
    .prepare(`UPDATE onboarding_sessions SET ${sets.join(', ')} WHERE session_id = ? AND revision = ? AND user_id = ?`)
    .bind(...vals, p.sessionId, p.expectedRevision, p.ownerUserId)
    .run();

  if ((result.meta.changes ?? 0) > 0) {
    const updated = await findSessionById(db, p.sessionId);
    if (!updated) return { ok: false, reason: 'not_found' };
    return { ok: true, session: updated };
  }

  const current = await findSessionById(db, p.sessionId);
  if (!current) return { ok: false, reason: 'not_found' };
  return { ok: false, reason: 'conflict', current };
}

export interface SessionListRow {
  session_id: string;
  packet_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
  application_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSessions(
  db: D1Database,
  params: { page: number; pageSize: number; status?: string; search?: string },
): Promise<{ sessions: SessionListRow[]; total: number }> {
  const { page, pageSize, status, search } = params;
  const offset = (page - 1) * pageSize;
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (status) { conditions.push('status = ?'); bindings.push(status); }
  if (search) {
    const like = `%${search}%`;
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)');
    bindings.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [data, count] = await Promise.all([
    db
      .prepare(`SELECT session_id, packet_id, first_name, last_name, email, status, application_id, created_at, updated_at FROM onboarding_sessions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, offset)
      .all<SessionListRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM onboarding_sessions ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);

  return { sessions: data.results, total: count?.total ?? 0 };
}
