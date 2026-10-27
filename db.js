import pg from "pg";

const { Pool } = pg;

// 扣子编程托管 PostgreSQL：连接凭据由平台注入环境变量。
// 优先 DATABASE_URL；否则 pg 客户端原生读取 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE。
function connConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {};
}

export const pool = new Pool({
  ...connConfig(),
  max: 3,
  idleTimeoutMillis: 15000,
  connectionTimeoutMillis: 8000,
});

export function dbEnvSummary() {
  const names = ["DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"];
  return Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
}

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_payload (
      business_date DATE PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS poster_asset (
      business_date DATE NOT NULL,
      kind TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/png',
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (business_date, kind)
    );
  `);
}
