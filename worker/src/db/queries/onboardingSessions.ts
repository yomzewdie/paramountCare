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
  created_at: string;
  updated_at: string;
}

export interface InsertSessionParams {
  sessionId: string;
  packetId: string;
  packetVersion: number;
}

export async function insertSession(
  db: D1Database,
  p: InsertSessionParams,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO onboarding_sessions (session_id, packet_id, packet_version)
       VALUES (?, ?, ?)`,
    )
    .bind(p.sessionId, p.packetId, p.packetVersion)
    .run();
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

export interface UpdateSessionParams {
  sessionId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  stepStatesJson?: string;
  formDataJson?: string;
  status?: string;
  applicationId?: string;
}

export async function updateSession(
  db: D1Database,
  p: UpdateSessionParams,
): Promise<void> {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const vals: (string | number | null)[] = [];

  if (p.firstName  !== undefined) { sets.push('first_name = ?');       vals.push(p.firstName); }
  if (p.lastName   !== undefined) { sets.push('last_name = ?');        vals.push(p.lastName); }
  if (p.email      !== undefined) { sets.push('email = ?');            vals.push(p.email); }
  if (p.phone      !== undefined) { sets.push('phone = ?');            vals.push(p.phone); }
  if (p.stepStatesJson !== undefined) { sets.push('step_states_json = ?'); vals.push(p.stepStatesJson); }
  if (p.formDataJson   !== undefined) { sets.push('form_data_json = ?');   vals.push(p.formDataJson); }
  if (p.status     !== undefined) { sets.push('status = ?');           vals.push(p.status); }
  if (p.applicationId !== undefined) { sets.push('application_id = ?'); vals.push(p.applicationId); }

  if (sets.length === 1) return; // nothing to update besides timestamp

  await db
    .prepare(`UPDATE onboarding_sessions SET ${sets.join(', ')} WHERE session_id = ?`)
    .bind(...vals, p.sessionId)
    .run();
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
