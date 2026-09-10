export interface ApplicationRow {
  id: number;
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  payload_json: string | null;
  submitted_at: string;
}

export interface InsertApplicationParams {
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  payloadJson: string;
  submittedAt: string;
}

export function insertApplicationStmt(
  db: D1Database,
  p: InsertApplicationParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO applications
         (application_id, first_name, last_name, email, phone, payload_json, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.applicationId, p.firstName, p.lastName, p.email, p.phone, p.payloadJson, p.submittedAt);
}

export async function findApplicationById(
  db: D1Database,
  applicationId: string,
): Promise<ApplicationRow | null> {
  return db
    .prepare('SELECT * FROM applications WHERE application_id = ? LIMIT 1')
    .bind(applicationId)
    .first<ApplicationRow>();
}

export interface ApplicationListRow {
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  submitted_at: string;
  document_count: number;
}

export interface ListApplicationsParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}

export async function listApplications(
  db: D1Database,
  params: ListApplicationsParams,
): Promise<{ applications: ApplicationListRow[]; total: number }> {
  const { page, pageSize, search, status } = params;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (status) {
    conditions.push('a.status = ?');
    bindings.push(status);
  }

  if (search) {
    const like = `%${search}%`;
    conditions.push(
      '(a.first_name LIKE ? OR a.last_name LIKE ? OR a.email LIKE ? OR a.application_id LIKE ?)',
    );
    bindings.push(like, like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const dataQuery = `
    SELECT
      a.application_id,
      a.first_name,
      a.last_name,
      a.email,
      a.status,
      a.submitted_at,
      (SELECT COUNT(*) FROM application_documents d WHERE d.application_id = a.application_id) AS document_count
    FROM applications a
    ${where}
    ORDER BY a.submitted_at DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `SELECT COUNT(*) AS total FROM applications a ${where}`;

  const [dataResult, countResult] = await Promise.all([
    db
      .prepare(dataQuery)
      .bind(...bindings, pageSize, offset)
      .all<ApplicationListRow>(),
    db
      .prepare(countQuery)
      .bind(...bindings)
      .first<{ total: number }>(),
  ]);

  return {
    applications: dataResult.results,
    total: countResult?.total ?? 0,
  };
}
