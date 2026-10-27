import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

// 扣子沙箱兜底：平台进程可能在数据库开通前启动，导致 PG* 未注入运行时。
// 若环境缺少 PG 配置且项目根存在 .env.db（沙箱内生成、不进 git），则加载之。
// 生产部署时平台会注入独立的数据库环境变量，此文件不存在即自动跳过。
(function loadDbEnvFallback() {
  if (process.env.PGHOST || process.env.DATABASE_URL) return;
  const file = path.resolve("../../../.env.db");
  const candidates = [path.resolve(".env.db"), file];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
      return;
    } catch { /* ignore */ }
  }
})();

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
