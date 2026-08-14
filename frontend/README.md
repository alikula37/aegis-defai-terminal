# Aegis DeFAI Terminal — Frontend

React 19 + Vite dashboard for the Aegis DeFAI agent: live portfolio, APY charts,
AI agent execution logs, backtesting, risk analytics and settings.

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

## Backend connectivity

- **REST:** `VITE_API_URL` (default `http://localhost:3001`). In the Vite dev
  server the proxy in `vite.config.js` forwards `/api` to the backend.
- **WebSocket:** `VITE_WS_URL` (default derived from `VITE_API_URL`: same origin,
  `ws(s)://` scheme, `/ws` path — matches the shipped nginx proxy).
- **Auth:** `AEGIS_API_KEY` (REST `x-api-key` header) and `WS_API_KEY`
  (WebSocket subprotocol) can be provided via env; the REST key is entered on
  the Settings page and kept in `localStorage`.
