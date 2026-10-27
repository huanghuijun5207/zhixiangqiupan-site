const state = { data: null };

function el(id) { return document.getElementById(id); }

function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

const CARD_KEYS = ["胜券在握", "一发入魂", "时来运转"];
const SUMMARY_LABELS = {
  hitRate: "命中率%", pnl: "累计盈亏", roi: "ROI%", nextStake: "下一期投入",
  totalStake: "累计投入", totalReturn: "累计返还", maxDrawdown: "最大回撤",
  settled: "已结算", pending: "待结算", tracked: "追踪场次", trackedDays: "追踪天数",
  currentSellingCount: "在售场次", saleDayCount: "销售日第", endingBankroll: "当前本金",
  maxSingleStake: "最大单注", maxLosingStreak: "最长连黑", goalHitRate: "进球命中%",
  top1HitRate: "Top1命中%", top3HitRate: "Top3命中%", observedDays: "观察天数",
  hits: "命中", misses: "未中",
};

function statGrid(summary) {
  if (!summary) return "";
  const items = Object.entries(summary)
    .filter(([, v]) => v !== "" && v != null)
    .slice(0, 12)
    .map(([k, v]) => {
      const label = SUMMARY_LABELS[k] || k;
      const num = Number(v);
      const cls = Number.isFinite(num) ? (num < 0 ? "down" : num > 0 ? "up" : "") : "";
      return `<div class="stat"><div class="k">${label}</div><div class="v ${cls}">${v}</div></div>`;
    });
  return `<div class="ledger-grid">${items.join("")}</div>`;
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
    renderCards(json.payload);
    renderPosters(json);
  } catch (err) {
    el("syncInfo").textContent = "数据加载失败";
    el("todayEmpty").textContent = "数据加载失败：" + String(err && err.message || err);
    el("todayEmpty").classList.remove("hidden");
  }
}

function renderCards(payload) {
  const list = el("todayList");
  list.innerHTML = "";
  const cards = payload?.cards || {};
  const keys = Object.keys(cards).filter((k) => cards[k]);
  const ordered = [...CARD_KEYS.filter((k) => keys.includes(k)), ...keys.filter((k) => !CARD_KEYS.includes(k))];
  if (!ordered.length) {
    el("todayEmpty").classList.remove("hidden");
    return;
  }
  el("todayEmpty").classList.add("hidden");
  for (const key of ordered) {
    const card = cards[key];
    const box = document.createElement("div");
    box.className = "match-card";
    const current = card.current
      ? `<div class="match-rec">当前主推：<span class="rec-tag"></span></div>`
      : "";
    box.innerHTML = `
      <div class="match-head">
        <span class="match-no">${key}</span>
        <span class="match-league"></span>
      </div>
      ${current}
      ${statGrid(card.summary)}
    `;
    box.querySelector(".match-league").textContent = card.title || "";
    if (card.current) {
      const cur = card.current;
      box.querySelector(".rec-tag").textContent = `${cur.matchNo || ""} ${cur.match || ""} ${cur.selectedGoals ? "· " + cur.selectedGoals + "球" : ""} ${cur.selectedScores ? "· " + cur.selectedScores : ""}`.trim();
    }
    list.appendChild(box);
  }
}

function renderPosters(json) {
  const kinds = Array.isArray(json.posters) ? json.posters.map((p) => p.kind) : [];
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
