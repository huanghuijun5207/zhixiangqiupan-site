import express from "express";
import crypto from "node:crypto";
import { pool, initSchema, dbEnvSummary } from "./db.js";

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const SYNC_TOKEN = process.env.SYNC_TOKEN || "";
const PORT = Number(process.env.PORT || 3000);

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireSyncToken(req, res) {
  if (!SYNC_TOKEN) {
    res.status(503).json({ ok: false, error: "SYNC_TOKEN 未配置" });
    return false;
  }
  const given = req.get("x-sync-token") || "";
  if (!timingSafeEqual(given, SYNC_TOKEN)) {
    res.status(401).json({ ok: false, error: "sync token 不匹配" });
    return false;
  }
  return true;
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "zhixiangqiupan-site", db: "up" });
  } catch (err) {
    res.status(500).json({ ok: true, service: "zhixiangqiupan-site", db: "down", dbEnv: dbEnvSummary(), message: String(err?.message || err).slice(0, 300) });
  }
});

app.get("/api/today", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT business_date, payload, updated_at FROM daily_payload ORDER BY business_date DESC LIMIT 1"
    );
    if (!rows.length) return res.json({ ok: true, empty: true });
    const row = rows[0];
    const posters = await pool.query(
      "SELECT kind, content_type, octet_length(data) AS bytes, updated_at FROM poster_asset WHERE business_date = $1 ORDER BY kind",
      [row.business_date]
    );
    res.json({
      ok: true,
      businessDate: row.business_date,
      payload: row.payload,
      posters: posters.rows,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) });
  }
});

app.get("/api/poster/:kind", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT content_type, data FROM poster_asset ORDER BY business_date DESC, kind LIMIT 1"
    );
    const target = await pool.query(
      "SELECT content_type, data FROM poster_asset WHERE business_date = (SELECT max(business_date) FROM poster_asset) AND kind = $1",
      [req.params.kind]
    );
    const row = target.rows[0] || rows[0];
    if (!row) return res.status(404).json({ ok: false, error: "海报不存在" });
    res.set("Content-Type", row.content_type || "image/png");
    res.set("Cache-Control", "public, max-age=600");
    res.send(row.data);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) });
  }
});

app.post("/api/sync", async (req, res) => {
  if (!requireSyncToken(req, res)) return;
  try {
    const body = req.body || {};
    const businessDate = String(body.businessDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return res.status(400).json({ ok: false, error: "businessDate 必须是 YYYY-MM-DD" });
    }
    if (!body.payload || typeof body.payload !== "object") {
      return res.status(400).json({ ok: false, error: "payload 缺失" });
    }
    await pool.query(
      `INSERT INTO daily_payload (business_date, payload, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (business_date) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [businessDate, JSON.stringify(body.payload)]
    );
    const posters = Array.isArray(body.posters) ? body.posters : [];
    let postersSaved = 0;
    for (const p of posters) {
      const kind = String(p.kind || "").slice(0, 60);
      const b64 = String(p.dataBase64 || "");
      if (!kind || !b64) continue;
      const buf = Buffer.from(b64, "base64");
      if (!buf.length || buf.length > 12 * 1024 * 1024) continue;
      await pool.query(
        `INSERT INTO poster_asset (business_date, kind, content_type, data, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (business_date, kind) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, updated_at = now()`,
        [businessDate, kind, String(p.contentType || "image/png"), buf]
      );
      postersSaved += 1;
    }
    res.json({ ok: true, businessDate, postersSaved });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) });
  }
});

// ---------- MiniMax 问答代理：消耗用户自己的 MiniMax token，不调用扣子内置模型 ----------

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1";
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || "MiniMax-M3.1-Flash-Preview";

const chatBuckets = new Map();
function chatAllowed(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const list = (chatBuckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= Number(process.env.CHAT_HOURLY_LIMIT || 30)) {
    chatBuckets.set(ip, list);
    return false;
  }
  list.push(now);
  chatBuckets.set(ip, list);
  return true;
}

function stripThink(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function latestContext() {
  const { rows } = await pool.query(
    "SELECT business_date, payload FROM daily_payload ORDER BY business_date DESC LIMIT 1"
  );
  if (!rows.length) return null;
  return { businessDate: rows[0].business_date, payload: rows[0].payload };
}

function compactPayload(payload) {
  // 只保留问答需要的摘要字段，控制 token 用量
  const p = payload || {};
  const summary = {
    summary: p.summary || undefined,
    matches: Array.isArray(p.matches)
      ? p.matches.slice(0, 40).map((m) => ({
          matchNo: m.matchNo, league: m.league, home: m.home, away: m.away,
          kickoff: m.kickoff, recommendation: m.recommendation, odds: m.odds,
        }))
      : undefined,
    picks: p.picks || undefined,
    ledger: p.ledger || undefined,
  };
  return JSON.stringify(summary).slice(0, Number(process.env.CHAT_CONTEXT_MAX_CHARS || 12000));
}

app.post("/api/chat", async (req, res) => {
  const ip = req.ip || "unknown";
  if (!chatAllowed(ip)) return res.status(429).json({ ok: false, error: "提问过于频繁，请稍后再试" });
  const question = String(req.body?.question || "").trim().slice(0, 2000);
  if (!question) return res.status(400).json({ ok: false, error: "question 缺失" });
  if (!process.env.MINIMAX_API_KEY) {
    return res.status(503).json({ ok: false, error: "站点尚未配置 MINIMAX_API_KEY" });
  }
  try {
    const ctx = await latestContext();
    const contextText = ctx
      ? `业务日期：${ctx.businessDate}。当日数据 JSON（可能被截断）：${compactPayload(ctx.payload)}`
      : "当前暂无同步数据。";
    const controller = new AbortController();
    const timeoutMs = Number(process.env.MINIMAX_TIMEOUT_MS || 60000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: Number(process.env.MINIMAX_MAX_TOKENS || 4096),
        messages: [
          {
            role: "system",
            content:
              "你是「智享球盘Agent」，一个体育竞彩数据分析助手。只基于给定的当日数据与常识回答，不得编造数据。所有回答都必须中立、克制，结尾提醒：仅供参考，不构成投注建议，请理性对待体彩竞彩。",
          },
          { role: "user", content: `${contextText}\n\n用户问题：${question}` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: `MiniMax HTTP ${resp.status}`, detail: text.slice(0, 300) });
    }
    const data = await resp.json();
    const answer = stripThink(data?.choices?.[0]?.message?.content);
    if (!answer) return res.status(502).json({ ok: false, error: "MiniMax 返回为空" });
    res.json({ ok: true, model: data?.model || MINIMAX_MODEL, answer });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    res.status(aborted ? 504 : 500).json({ ok: false, error: aborted ? "MiniMax 响应超时" : String(err?.message || err).slice(0, 300) });
  }
});

async function main() {
  try {
    await initSchema();
  } catch (err) {
    console.error("schema init failed (degraded start):", String(err?.message || err).slice(0, 200));
  }
  app.listen(PORT, () => {
    console.log(`zhixiangqiupan-site listening on :${PORT}`);
    console.log("db env present:", JSON.stringify(dbEnvSummary()));
    console.log("minimax key configured:", Boolean(process.env.MINIMAX_API_KEY));
    console.log("sync token configured:", Boolean(SYNC_TOKEN));
  });
}

main().catch((err) => {
  console.error("startup failed:", err);
  process.exit(1);
});
