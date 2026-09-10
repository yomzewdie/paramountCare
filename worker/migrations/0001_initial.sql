CREATE TABLE IF NOT EXISTS applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT UNIQUE NOT NULL,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted',
  payload_json   TEXT,
  submitted_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  file_size      INTEGER NOT NULL,
  uploaded_at    TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(application_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  action         TEXT NOT NULL,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES applications(application_id)
);

CREATE INDEX IF NOT EXISTS idx_app_docs_app_id   ON application_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_app_id ON audit_logs(application_id);
