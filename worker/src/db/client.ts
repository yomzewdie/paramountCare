export interface DbClient {
  db: D1Database;
  batch: (stmts: D1PreparedStatement[]) => Promise<D1Result[]>;
}

export function createDbClient(db: D1Database): DbClient {
  return {
    db,
    batch: (stmts) => db.batch(stmts),
  };
}
