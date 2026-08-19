# 🧠 Aegis DeFAI Terminal — How It Works

Aegis is an **autonomous, AI-driven DeFi agent** that farms delta-neutral yield and
protects your position from liquidation — 24/7. It does not simply "borrow and
lend": it watches the market, reasons about risk with an LLM, and acts on your
behalf.

```mermaid
graph TD
    subgraph Data Layer
        A[Live oracles / DeFiLlama] --> B[Market Snapshot]
        C[Stochastic SIM engine] --> B
    end

    subgraph Risk Engine
        B --> D{Health Factor Check}
        D -->|HF ≥ warning| E[Safe Zone: maximize yield]
        D -->|critical ≤ HF < warning| F[Warning Zone: stop new debt]
        D -->|HF < critical| G[Critical Zone: rescue action]
    end

    subgraph AI Brain (LLM)
        E --> H((Your chosen model))
        F --> H
        G --> H
        H -->|read-only tools + context| I{Decision}
        I -->|hold| J[Keep position]
        I -->|adjust_portfolio| K[Tune LTV / collateral]
        I -->|reallocate_capital| L[Shift Loop / Basis / JIT]
        I -->|flash_loan_rescue| M[Emergency flash loan]
    end

    subgraph Execution & Memory
        J --> N[Execute plan]
        K --> N
        L --> N
        M --> N
        N --> O[(SQLite memory)]
        B --> O
    end
```

## 1. Data — live oracles or a stochastic simulation

Every cycle (15 seconds by default) the agent builds a **market snapshot**:

- **LIVE mode (default):** real prices and APYs for ETH, USDC and sUSDe, plus
  live rates from DeFiLlama pools (Ethena, Pendle, Morpho Blue) and on-chain
  borrow rates.
- **SIM mode:** a **stochastic simulation engine** models the same market with
  Ornstein-Uhlenbeck processes, a GBM ETH price path and correlated shocks —
  including a gradual **depeg scenario** for sUSDe. The simulation is fully
  **seeded**: the same seed + scenario always produces the same path, which is
  what makes backtesting and the quant layer deterministic and verifiable.

The same snapshot feeds the risk engine, the LLM and the dashboard, so every
decision is explainable.

## 2. The strategy — three delta-neutral primitives

Capital is split between three primitives, and the agent rebalances between them
as conditions change:

| Primitive | What it does | Risk |
|---|---|---|
| **Loop** | Borrows USDC against sUSDe/PT-sUSDe collateral and re-loops it — the delta-neutral yield engine | Medium |
| **Basis** | Hedges Ethena's funding-rate exposure (the insurance leg) | Low (hedge) |
| **JIT** | Provides concentrated Uniswap liquidity while idle | Low–medium |

The default allocation starts at **100% Loop**; the agent can shift between
primitives with the `reallocate_capital` decision to maximize the blended net APY.

## 3. Risk engine — the Health Factor

Leverage means liquidation risk, so the agent computes the **Health Factor (HF)** on
every cycle:

```
HF = (Collateral Value × Liquidation Threshold) / Debt Value
```

The risk zones depend on your **risk appetite** — set on the **new-simulation
start screen** or the **Settings page**; the two are always in sync. Picking an
appetite snaps the Target HF to its preset, and editing the Target HF directly
re-derives the appetite label (Conservative 1.40 · Balanced 1.25 · Aggressive
1.20). The agent applies the persisted value on every cycle, so the Overview
dashboard, Settings and the simulation's actual risk zones can never drift:

| Appetite | Target HF | Warning zone | Critical |
|---|---|---|---|
| **Conservative** | 1.40 | 1.30 – 1.40 | < 1.25 |
| **Balanced** (default) | 1.25 | 1.21 – 1.25 | < 1.15 |
| **Aggressive** | 1.20 | 1.15 – 1.20 | < 1.10 |

- 🟢 **Safe (HF ≥ warning):** the agent keeps maximizing yield.
- 🟡 **Warning:** new debt is stopped, positions are tightened.
- 🔴 **Critical:** the agent triggers a rescue (see below).

## 4. The AI brain — your model, its tools

The AI brain is **optional and credit-free by default**. Three **Brain Modes**
are available in Settings **and on the new-simulation start screen**:

| Mode | Behavior |
|---|---|
| **Auto** *(default)* | Tries your selected model (free models first). If OpenRouter is unreachable, returns **Payment Required** (no credits) or the key is missing, the agent **automatically falls back to the built-in rule engine** — no crash, no spam. |
| **Local only** | Never calls OpenRouter — pure rule-based engine. Works with **no API key and zero balance** on live data. |
| **AI only** | Always consults the LLM; requires a valid key with credits. |

The one-click **"Run free — no credits"** button in Settings switches to Auto
mode with the best curated free model. Failures are throttled to a single
friendly notification (up to once per 10 minutes), and every cycle still
produces a deterministic decision.

When the portfolio enters the **Warning** or **Critical** zone (or a decision
point is reached), the agent consults an LLM through **OpenRouter**. You choose
the model from the **same picker** on the **Settings** page and the
new-simulation start screen (free models are pinned on top, then the live
OpenRouter catalog grouped by vendor, then your custom ids). The default is a
**free** model (`google/gemini-2.5-flash-exp:free`), and whatever you select in
either place is what the agent uses — the two screens never drift.

The prompt contains the full current state (HF, LTV, allocations, APYs, spread,
TVL) plus what its read-only tools report (`get_market_snapshot`,
`get_historical_yields`, `run_backtest`, …). The model answers with one of:

| Decision | Meaning |
|---|---|
| `hold` | Market stable, keep the position |
| `adjust_portfolio` | Change LTV or collateral type |
| `reallocate_capital` | Shift between Loop / Basis / JIT |
| `flash_loan_rescue` | **Critical:** take a flash loan, repay debt, save collateral |
| `claim` | Claim accrued profit when it beats gas cost |
| `migrate_borrow` / `cross_chain_migrate` | Move borrowing to a cheaper rate |

Tool calls and LLM round-trips are **budgeted** (max calls per cycle, max tool
rounds) so a single bad response can never stall the agent.

## 5. Execution & memory

- **Execution mode:** `simulation` (default, no real funds) or `onchain`
  (Sepolia / a local mainnet fork — the agent refuses to trade if no provider
  and signer are configured).
- **Memory:** every decision, its reasoning and the resulting portfolio state are
  stored in SQLite (`decision_memory`, `portfolio_history`, `agent_logs`), so the
  whole history is replayable.

## 6. The data-science layer (dashboard)

The terminal quantifies performance — it is not just a chart:

- **Risk metrics** (`/api/portfolio/metrics`): Sharpe & Sortino ratios,
  annualized volatility, max drawdown, **Value at Risk (VaR)** and **CVaR**,
  win-rate, beta, **Calmar ratio**, **tail ratio**, plus the chart payloads —
  a normalized **equity curve**, a **return histogram** and **rolling (30-day)
  volatility** — computed on the simulation's observed history.
- **Yield forecast** (`/api/forecast/:metric`): a Holt linear-trend projection of
  net APY and TVL with an EWMA volatility band. This is an **educational
  estimate, not a promise** (clearly labelled in the UI).
- **Backtesting** (`/api/backtest`): historical scenarios with an 80/20
  out-of-sample split, bootstrap confidence intervals and the same risk metrics.
- **Live opportunities** (`/api/analytics/opportunities`): a ranked, risk-labeled
  snapshot of **real current yields** across the strategy universe — sUSDe
  staking, Pendle fixed yield, Morpho USDC supply and reward-boosted vaults,
  Aave, and selected RWA/private-credit pools. Each card shows base vs reward
  APY, TVL, DefiLlama's ML trend prediction and a plain-language risk tier
  (Low/Medium/High). Benchmarks (T-Bill from FRED, ETH staking) are shown for
  context, and the delta-neutral loop is flagged honestly when its net spread
  is currently negative.
- **Strategy comparison** (`/api/analytics/strategies`): backtests the whole
  strategy universe side-by-side (sUSDe stake, Pendle, Morpho supply, the
  leverage loop) with CAGR, Sharpe, max drawdown and a Conservative/Balanced/
  Aggressive risk grade — so a user can see that "the loop is not always the
  best vehicle".
- **Rate scenarios**: an interactive slider panel that recomputes the loop's
  net APY live from editable sUSDe / borrow / leverage / gas inputs.
- **Glossary tooltips** hover over every financial term (HF, APY, TVL, spread,
  delta-neutral, leverage, LTV, Sharpe, Sortino, VaR, CAGR, max drawdown,
  win rate, volatility, Calmar, tail ratio, RWA credit, …) — in English and
  Turkish.

## 7. The dashboard

The web terminal (localhost:5173) has six pages:

| Page | What you see |
|---|---|
| **Overview** | Live TVL, net APY, health factor, risk zone, forecast chart + risk-metric cards, and the start/stop controls |
| **Yield Strategies** | How capital is allocated across the primitives |
| **Analytics** | Live opportunity dashboard with benchmarks, market outlook, rate scenarios, strategy comparison and deep-dive backtest/Monte Carlo/leverage-sweep panels — every metric explained in plain language |
| **Live Data** | Real-time market data, borrow rates, cross-chain opportunities |
| **AI Agent Logs** | A live "agent console" — what the AI decided and why, streaming in real time |
| **Settings** | Your API keys (encrypted at rest), model selection and risk appetite |

> The interface is available in **English** and **Turkish**, and every number has
> a plain-language explanation behind a tooltip — the terminal is built to teach,
> not just to display.