# zhixiangqiupan-site（智享球盘Agent 对外展示站）

部署在扣子编程的轻量展示层。**所有运算在本地引擎完成**，本站只做两件事：

1. 接收本地引擎每日推送的数据（`POST /api/sync`，`X-Sync-Token` 鉴权），存入平台托管 PostgreSQL；
2. 对外展示当日推荐、海报图、战绩台账，并提供基于站长自有 MiniMax API Key 的问答代理（不调用扣子内置模型，不消耗扣子模型积分）。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SYNC_TOKEN` | 是 | 本地推送鉴权 token |
| `DATABASE_URL` 或 `PG*` | 平台注入 | 扣子托管 PostgreSQL 连接凭据 |
| `MINIMAX_API_KEY` | 问答需要 | 站长自己的 MiniMax key |
| `MINIMAX_BASE_URL` | 否 | 默认 `https://api.minimax.io/v1` |
| `MINIMAX_MODEL` | 否 | 默认 `MiniMax-M3.1-Flash-Preview` |
| `CHAT_HOURLY_LIMIT` | 否 | 每 IP 每小时提问上限，默认 30 |

## API

- `GET /api/health` — 健康 + 数据库连通
- `GET /api/today` — 最新业务日 payload 与海报索引
- `GET /api/poster/:kind` — 海报 PNG
- `POST /api/sync` — `{businessDate, payload, posters:[{kind, contentType, dataBase64}]}`，需 `X-Sync-Token`
- `POST /api/chat` — `{question}`，走 MiniMax

## 免责声明

数据仅供个人研究学习参考，不构成任何投注建议。
