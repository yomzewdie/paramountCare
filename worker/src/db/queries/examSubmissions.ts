export interface ExamSubmissionRow {
  id: number;
  session_id: string;
  step_id: string;
  exam_type: string;
  answers_json: string;
  score: number;
  passed: number; // 0 | 1
  attempt_number: number;
  submitted_at: string;
}

export interface InsertExamSubmissionParams {
  sessionId: string;
  stepId: string;
  examType: string;
  answersJson: string;
  score: number;
  passed: boolean;
  attemptNumber: number;
}

export async function insertExamSubmission(
  db: D1Database,
  p: InsertExamSubmissionParams,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO exam_submissions
         (session_id, step_id, exam_type, answers_json, score, passed, attempt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(p.sessionId, p.stepId, p.examType, p.answersJson, p.score, p.passed ? 1 : 0, p.attemptNumber)
    .run();
}

export async function countExamAttempts(
  db: D1Database,
  sessionId: string,
  stepId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS cnt FROM exam_submissions WHERE session_id = ? AND step_id = ?')
    .bind(sessionId, stepId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

export async function listExamSubmissionsForSession(
  db: D1Database,
  sessionId: string,
): Promise<ExamSubmissionRow[]> {
  const result = await db
    .prepare('SELECT * FROM exam_submissions WHERE session_id = ? ORDER BY submitted_at ASC')
    .bind(sessionId)
    .all<ExamSubmissionRow>();
  return result.results;
}
