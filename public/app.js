const state = { data: null, posterKinds: [], activePoster: null };

function el(id) { return document.getElementById(id); }

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

async function loadToday() {
  try {
    const resp = await fetch("/api/today");
    const json = await resp.json();
    if (!json.ok || json.empty) {
      el("syncInfo").textContent = "暂无同步数据";
      el("todayEmpty").classList.remove("hidden");
      return;
    }
    state.data = json;
    el("syncInfo").textContent = `数据日期 ${json.businessDate} · 同步于 ${fmtDateTime(json.updatedAt)}`;
    renderMatches(json.payload);
    renderLedger(json.payload);
    renderPosters(json);
  } catch (err) {
    el("syncInfo").textContent = "数据加载失败";
    el("todayEmpty").textContent = "数据加载失败：" + String(err && err.message || err);
    el("todayEmpty").classList.remove("hidden");
  }
}

function firstText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(firstText).filter(Boolean).join(" / ");
  if (typeof v === "object") return v.label || v.text || v.name || v.title || "";
  return "";
}

function renderMatches(payload) {
  const list = el("todayList");
  list.innerHTML = "";
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  if (!matches.length) {
    el("todayEmpty").classList.remove("hidden");
    return;
  }
  el("todayEmpty").classList.add("hidden");
  for (const m of matches) {
    const card = document.createElement("div");
    card.className = "match-card";
    const teams = `${firstText(m.home) || "?"} vs ${firstText(m.away) || "?"}`;
    const rec = firstText(m.recommendation) || firstText(m.pick) || firstText(m.plan);
    const odds = firstText(m.odds);
    card.innerHTML = `
      <div class="match-head">
        <span class="match-no">${firstText(m.matchNo) || ""}</span>
        <span class="match-league">${firstText(m.league) || ""}</span>
        <span class="match-kick">${firstText(m.kickoff) || firstText(m.kickoffTime) || ""}</span>
      </div>
      <div class="match-teams"></div>
      ${rec ? `<div class="match-rec">方案：<span class="rec-tag"></span></div>` : ""}
      ${odds ? `<div class="match-odds"></div>` : ""}
    `;
    card.querySelector(".match-teams").textContent = teams;
    if (rec) card.querySelector(".rec-tag").textContent = rec;
    if (odds) card.querySelector(".match-odds").textContent = odds;
    list.appendChild(card);
  }
}

function statRow(label, value, cls) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<div class="stat"><div class="k">${esc(label)}</div><div class="v ${cls || ""}">${esc(value)}</div></div>`;
}

function renderLedger(payload) {
  const box = el("ledgerBox");
  const ledger = payload?.ledger;
  if (!ledger || typeof ledger !== "object") {
    box.textContent = "暂无台账数据。";
    box.className = "empty";
    return;
  }
  box.className = "ledger-box";
  const items = Object.entries(ledger)
    .filter(([, v]) => v != null && typeof v !== "object")
    .map(([k, v]) => statRow(k, firstText(v), String(v).includes("-") ? "down" : "up"));
  box.innerHTML = `
    <div style="font-weight:700">战绩台账</div>
    <div class="ledger-grid">${items.join("") || "暂无统计字段"}</div>
  `;
}

function renderPosters(json) {
  const kinds = Array.isArray(json.posters) ? json.posters.map((p) => p.kind) : [];
  state.posterKinds = kinds;
  const tabs = el("posterTabs");
  tabs.innerHTML = "";
  if (!kinds.length) {
    el("posterStage").innerHTML = `<div class="empty">暂无海报。</div>`;
    return;
  }
  kinds.forEach((kind, i) => {
    const btn = document.createElement("button");
    btn.className = "poster-tab" + (i === 0 ? " active" : "");
    btn.textContent = kind;
    btn.onclick = () => showPoster(kind);
    tabs.appendChild(btn);
  });
  showPoster(kinds[0]);
}

function showPoster(kind) {
  state.activePoster = kind;
  document.querySelectorAll(".poster-tab").forEach((b) => {
    b.classList.toggle("active", b.textContent === kind);
  });
  el("posterStage").innerHTML = `<img alt="${kind}" src="/api/poster/${encodeURIComponent(kind)}?t=${Date.now()}" />`;
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    el("tab-" + tab.dataset.tab).classList.add("active");
  });
});

async function sendChat() {
  const input = el("chatInput");
  const btn = el("chatSend");
  const text = input.value.trim();
  if (!text || btn.disabled) return;
  input.value = "";
  btn.disabled = true;
  const log = el("chatLog");
  const userMsg = document.createElement("div");
  userMsg.className = "msg user";
  userMsg.textContent = text;
  log.appendChild(userMsg);
  const botMsg = document.createElement("div");
  botMsg.className = "msg bot";
  botMsg.textContent = "思考中…";
  log.appendChild(botMsg);
  log.scrollTop = log.scrollHeight;
  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });
    const json = await resp.json();
    botMsg.textContent = json.ok ? json.answer : `出错了：${json.error || resp.status}`;
  } catch (err) {
    botMsg.textContent = "网络错误：" + String(err && err.message || err);
  } finally {
    btn.disabled = false;
    log.scrollTop = log.scrollHeight;
  }
}

el("chatSend").addEventListener("click", sendChat);
el("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

loadToday();
