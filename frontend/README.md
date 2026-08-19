# Aegis DeFAI Terminal — Frontend

React 19 + Vite dashboard for the Aegis DeFAI agent: live portfolio, APY charts,
AI agent execution logs, and a full **Strategy Analytics** page (live opportunity
dashboard with FRED T-Bill / ETH-staking benchmarks, multi-strategy backtest
comparison, Monte Carlo, leverage sweep, rate scenarios and live risk metrics).

## Pages

- **Overview** — TVL, net APY, health factor, forecast + risk-metric cards
- **Yield Strategies** — capital allocation + transaction analytics
- **Analytics** — `/analytics`: opportunities dashboard, market outlook,
  strategy comparison, rate scenarios and deep-dive backtest panels
- **Live Data**, **AI Agent Logs**, **Settings**

## Development

```bash
npm install
npm run dev          # http://localhost:5173 (proxy → backend :3001)
```

## Tests / build

```bash
npm test             # vitest unit tests
npm run test:e2e     # Playwright end-to-end (backend must be running)
npm run lint
npm run build
```

The Playwright suite runs **three viewport projects** — desktop (1280px),
mobile (375px) and tablet (768px). The visual-regression spec
(`e2e/visual.spec.js`) asserts no horizontal overflow on every page and compares
committed pixel baselines (`.png` under `e2e/visual.spec.js-snapshots/`).

## Backend connectivity

- **REST:** `VITE_API_URL` (default `http://localhost:3001`). In the Vite dev
  server the proxy in `vite.config.js` forwards `/api` to the backend.
- **WebSocket:** `VITE_WS_URL` (default derived from `VITE_API_URL`: same origin,
  `ws(s)://` scheme, `/ws` path — matches the shipped nginx proxy).
- **Auth:** `AEGIS_API_KEY` (REST `x-api-key` header) and `WS_API_KEY`
  (WebSocket subprotocol) can be provided via env; the REST key is entered on
  the Settings page and kept in `localStorage`.
