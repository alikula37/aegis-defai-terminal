import logger from './utils/logger.js';
import { callLLM } from './services/LLMService.js';
import { insertLog, insertPortfolioStats, getLatestPortfolio, insertMemory, getRecentMemories, resetPortfolio, getSettings, getLogs } from './db/database.js';
import { MarketDataSource } from './core/data/MarketDataSource.js';
import { HistoricalDataService } from './services/HistoricalDataService.js';
import { Backtester } from './backtest/Backtester.js';
import { setRngSeed } from './utils/rng.js';
import { simulationState } from './core/agentState.js';
import { evaluateMarketConditions } from './core/RiskEngine.js';
import { deterministicFallback, validateLLMDecision, shouldCallLLM, normalizeReasoning, capPromptTokens } from './core/DecisionEngine.js';
import { LLMBudget, supportsTools } from './core/LLMBudget.js';
import { ToolExecutor } from './core/tools/executor.js';
import { runToolAgent } from './core/tools/agentLoop.js';
import { createExecutionLayer } from './execution/ExecutionLayer.js';
import { resolveOnchainDeps, resolveExecutionMode } from './execution/onchainSetup.js';
import aegisConfig from './aegis.config.js';
import { notificationService } from './utils/NotificationService.js';
import { trace } from './monitoring/tracing.js';

// ---- Retry utility ----
async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, name = '' } = {}) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) throw error;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            logger.info(`[RETRY] ${name} attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

export class AegisAgent {
    constructor(broadcastFn, options = {}) {
        this.broadcast = broadcastFn;
        this.isRunning = false;
        this.cycleTimeoutId = null;
        this.cycleIntervalMs = 30000;
        this.oracleTickerId = null;
        this.cooldowns = {};
        this.activeSimulationId = null;
        this.simulationSettings = {};
        this.lastInitialBalance = 10000;
        this.llmBudget = new LLMBudget({
            maxCallsPerCycle: aegisConfig.llm.budget.maxCallsPerCycle,
            weeklyMaxCalls: aegisConfig.llm.budget.weeklyMaxCalls || 0,
        });

        // Faz 3 — tool-calling: executor with a per-cycle tool budget and an
        // audit sink that persists every tool call into agent_logs.
        this.metrics = options.metrics || null;
        this.toolExecutor = options.toolExecutor || new ToolExecutor({
            maxCallsPerCycle: aegisConfig.llm.tools.maxToolCalls,
            auditSink: entry => this._recordToolAudit(entry),
        });

        // Execution backend: 'simulation' (default) or 'onchain'.
        // options.executionMode / options.onchain override config/env (used by
        // tests and embedders); EXECUTION_MODE env overrides the config default.
        this.executionMode = resolveExecutionMode(options.executionMode, aegisConfig.execution.mode);
        // chainId: explicit option → EVM_CHAIN_ID env (mainnet fork runs) →
        // config default
        this.executionChainId = options.onchain?.chainId
            ?? (process.env.EVM_CHAIN_ID ? Number(process.env.EVM_CHAIN_ID) : aegisConfig.execution.chainId);
        this.executionDeps = this.executionMode === 'onchain'
            ? (options.onchain?.deps ?? resolveOnchainDeps({
                rpcUrl: options.onchain?.rpcUrl ?? aegisConfig.execution.rpcUrl ?? process.env.EVM_PROVIDER_URL,
                privateKey: options.onchain?.privateKey ?? process.env.EVM_PRIVATE_KEY,
                chainId: this.executionChainId,
            }))
            : { provider: null, signer: null, address: null };
        // Ready = simulation always, onchain only with provider + signer.
        this.executionReady = this.executionMode === 'simulation'
            || Boolean(this.executionDeps.provider && this.executionDeps.signer);
        this.executionWarningShown = false;
        this._lastReasoningDetails = null;
        this._lastMarketData = null;

        // Phase 4 (C7) — external notification fan-out (Telegram/email). Injected
        // in tests; defaults to the env-driven singleton. Fire-and-forget.
        // Guard: a broken injected notifier must never throw out of the
        // watchdog callback (which uses raw logAndBroadcast).
        this.notifier = options.notifier && typeof options.notifier.notify === 'function'
            ? options.notifier
            : notificationService;

        this.executionLayer = createExecutionLayer(this.executionMode, this._buildExecutionCtx(), {
            provider: this.executionDeps.provider,
            signer: this.executionDeps.signer,
            chainId: this.executionChainId,
            config: aegisConfig.execution,
            connectors: options.onchain?.connectors,
        });
        logger.info(`[EXECUTION] 🚀 Execution backend: ${this.executionMode}${this.executionMode === 'onchain' ? ` (chainId ${this.executionChainId}, signer: ${this.executionReady ? this.executionDeps.address : 'MISSING'})` : ''}`);
        if (this.executionMode === 'onchain' && !this.executionReady) {
            logger.warn('[EXECUTION] ⚠️ Onchain mode is NOT ready: configure EVM_PROVIDER_URL + EVM_PRIVATE_KEY (testnet only), or set execution.mode="simulation". Agent will run read-only.');
        }
    }

    // Runtime status exposed via REST/WS so the UI can show which execution
    // backend is active and whether trades can actually be broadcast.
    getExecutionStatus() {
        return {
            mode: this.executionMode,
            chainId: this.executionChainId,
            providerConfigured: Boolean(this.executionDeps.provider),
            signerConfigured: Boolean(this.executionDeps.signer),
            signerAddress: this.executionDeps.address || null,
            ready: this.executionReady,
        };
    }

    _buildExecutionCtx() {
        const ctx = {
            state: simulationState,
            settings: () => this.simulationSettings,
            cooldowns: this.cooldowns,
            broadcast: (type, payload) => this.broadcast(type, payload),
            log: (type, message, details) => this.logAndBroadcast(type, message, details),
            insertMemory: (md, action, success, pnl) => insertMemory(md, action, success, pnl, this.activeSimulationId, this._lastReasoningDetails),
            insertPortfolioStats: (...args) => insertPortfolioStats(...args),
        };
        // Live getter: reads the agent's current simulation id at call time so
        // the execution backends always persist against the active simulation.
        Object.defineProperty(ctx, 'activeSimulationId', {
            get: () => this.activeSimulationId,
            enumerable: true,
        });
        return ctx;
    }

    // ---- Always-on Oracle Ticker (runs even when simulation is IDLE) ----
    startOracleTicker() {
        if (this.oracleTickerId) return; // Already running
        logger.info('[ORACLE] 🔄 Starting passive oracle ticker (60s interval)...');
        // Run immediately on start, then every 60 seconds
        this._broadcastOracle();
        this.oracleTickerId = setInterval(() => this._broadcastOracle(), 60000);
    }

    stopOracleTicker() {
        if (this.oracleTickerId) {
            clearInterval(this.oracleTickerId);
            this.oracleTickerId = null;
        }
    }

    async _broadcastOracle() {
        try {
            const marketData = await withRetry(() => MarketDataSource.getSnapshot(simulationState, { simulationId: this.activeSimulationId, userId: this.ownerUserId }), { name: 'MarketDataSource.getSnapshot' });
            // Build a rich oracle payload (no DB write, just broadcast)
            const portfolio = await getLatestPortfolio(this.activeSimulationId);
            this.broadcast('portfolio_update', {
                // Core portfolio (from DB)
                tvl: portfolio.tvl,
                net_apy: portfolio.net_apy,
                health_factor: portfolio.health_factor,
                // Live oracle fields
                ...marketData.portfolio,
                oracleStatus: marketData.oracleStatus,
                // Top-level oracle fields for LiveData page
                ethPrice: marketData.ethPrice,
                usdcPrice: marketData.usdcPrice,
                susdeApy: marketData.susdeApy,
                pendlePtSusdeApy: marketData.pendlePtSusdeApy,
                morphoBorrowApy: marketData.morphoBorrowApy,
                aaveV4BorrowApy: marketData.aaveV4BorrowApy,
                bestBorrowApy: marketData.bestBorrowApy,
                baseSpread: marketData.baseSpread,
                leverage: marketData.leverage,
                netApy: marketData.netApy,
                gasPrice: marketData.gasPrice,
                blockNumber: marketData.blockNumber,
                points: marketData.points,
                crossChain: marketData.crossChain,
            });
            logger.info('[ORACLE] ✅ Passive oracle broadcast sent.');
        } catch (err) {
            logger.info('[ORACLE] ⚠️ Passive oracle tick failed:', err.message);
        }
    }

    async startSimulation(initialBalance, settings = {}, simulationName = 'Default Simulation', opts = {}) {
        if (this.isRunning) return;

        // E9 — the simulation's owner binds every cycle's DB write + WS stream
        // to one user. server.js always passes it; tests may omit (open mode).
        if (opts.ownerUserId !== undefined) {
            this.ownerUserId = opts.ownerUserId;
        }

        this.simulationSettings = settings;
        this.startTime = Date.now();

        // Deterministic seed: same seed -> same random simulation events
        if (settings.seed) {
            this.simulationSeed = setRngSeed(settings.seed);
        } else {
            this.simulationSeed = setRngSeed(this.startTime);
        }

        logger.info(`[SYSTEM] 🟢 Starting simulation: ${simulationName} with initial balance: $${initialBalance}`);
        logger.info(`[SYSTEM] 🎲 Simulation seed: ${this.simulationSeed}`);
        this.lastInitialBalance = initialBalance;

        // Reset portfolio in DB BEFORE flipping isRunning: a failed reset must
        // not leave the agent wedged in a running-but-inert state (later
        // starts are silently ignored while isRunning=true).
        if (!settings.isResume) {
            // E9 — prune/new simulation are scoped to the owner.
            const result = await resetPortfolio(initialBalance, simulationName, null, this.ownerUserId);
            this.activeSimulationId = result.simulationId;
        }

        this.isRunning = true;
        this.executionWarningShown = false;
        this.broadcast('simulation_status', { isRunning: true, startTime: this.startTime, simulationName, execution: this.getExecutionStatus() });

        // Run first cycle immediately (don't await to avoid blocking the API response)
        this.runCycle().catch(err => logger.error('Initial runCycle failed:', err));

        // Adjust interval based on frequency
        this.cycleIntervalMs = 30000; // Default Medium
        if (settings.frequency === 'High') this.cycleIntervalMs = 15000;
        if (settings.frequency === 'Low') this.cycleIntervalMs = 60000;

        // Start recursive timeout loop
        this._scheduleNextCycle();
    }

    _scheduleNextCycle() {
        if (!this.isRunning) return;
        this.cycleTimeoutId = setTimeout(async () => {
            if (!this.isRunning) return;
            try {
                await this.runCycle();
            } catch (err) {
                // A single failed cycle must never kill the agent loop — the
                // watchdog + this catch keep the scheduler alive.
                logger.error(`[SYSTEM] ❌ Cycle failed, continuing: ${err.message}`);
                this.logAndBroadcastSafe('alert', `⚠️ Cycle failed (${err.message.slice(0, 120)}). Continuing.`);
            }
            this._scheduleNextCycle();
        }, this.cycleIntervalMs);
    }

    stopSimulation() {
        this.isRunning = false;
        this.startTime = null;
        this.broadcast('simulation_status', { isRunning: false, startTime: null });
        if (this.cycleTimeoutId) {
            clearTimeout(this.cycleTimeoutId);
            // Stress/hygiene: a cleared timer must not be mistaken for a live
            // one on the next start (startSimulation re-schedules).
            this.cycleTimeoutId = null;
        };
        // Cancel pending deferred portfolio writes from the previous run
        this.executionLayer?.dispose?.();
        logger.info('[SYSTEM] 🗑️ Simulation data reset.');
    }

    // Resets the active simulation: stops the loop and restarts fresh with the
    // last initial balance (startSimulation wipes and re-seeds the portfolio).
    async resetSimulation() {
        const balance = this.lastInitialBalance ?? 10000;
        const name = `Reset ${new Date().toLocaleTimeString()}`;
        this.stopSimulation();
        await this.startSimulation(balance, { ...this.simulationSettings, isResume: false }, name);
    }

    logAndBroadcast(type, message, details = null) {
        insertLog('info', type, message, details, this.activeSimulationId);
        this.broadcast('agent_log', {
            timestamp: new Date().toISOString(),
            type,
            message,
            details
        });
        logger.info(`[${type.toUpperCase()}] ${message}`);
        // C7 — fan out critical events to external channels (no-op when unconfigured).
        this.notifier.notify(type, message, details).catch(() => {});
    }

    // Error-path variant: a DB hiccup must never throw out of a catch handler
    // and kill the cycle scheduler.
    logAndBroadcastSafe(type, message, details = null) {
        try {
            this.logAndBroadcast(type, message, details);
        } catch (err) {
            try {
                this.broadcast('agent_log', { timestamp: new Date().toISOString(), type, message, details });
            } catch (_) { /* no-op: WS broadcast failure is not fatal */ }
            logger.error(`logAndBroadcast failed: ${err.message}`);
        }
    }

    // ---- Read-only data context handed to Faz 3 tools ----
    _buildToolContext() {
        return {
            marketData: this._lastMarketData,
            simulationId: this.activeSimulationId,
            historicalService: HistoricalDataService,
            backtester: Backtester,
            getRecentMemories: (limit, simulationId) => getRecentMemories(limit, simulationId),
            getLogs: (limit, offset, type, simulationId) => getLogs(limit, offset, type, simulationId),
        };
    }

    // Every tool call lands in agent_logs (type='tool') so decisions stay auditable.
    _recordLLMMetric(activeModel, kind) {
        if (!this.metrics) return;
        try {
            this.metrics.llmCalls.labels(activeModel || 'default', kind).inc();
        } catch {
            // metrics must never break the cycle
        }
    }

    _recordCycleMetrics() {
        if (!this.metrics) return;
        try {
            this.metrics.llmCallsPerCycle.set(this.llmBudget.callsThisCycle);
            this.metrics.toolCallsPerCycle.set(this.toolExecutor ? this.toolExecutor.callsUsed : 0);
        } catch {
            // metrics must never break the cycle
        }
    }

    _recordToolAudit(entry) {
        try {
            insertLog('info', 'tool', `[Tool] ${entry.name} ${entry.ok ? 'ok' : entry.error} (${entry.durationMs}ms)`, { args: entry.args }, this.activeSimulationId);
        } catch {
            // audit logging must never break the cycle
        }
        if (this.metrics) {
            try {
                this.metrics.toolCalls.labels(entry.name, entry.ok ? 'ok' : 'error').inc();
                this.metrics.toolCallDuration.labels(entry.name).observe((entry.durationMs || 0) / 1000);
            } catch {
                // metrics must never break the cycle
            }
        }
    }

    async _makeDecision(marketData, conditions, settings) {
        if (shouldCallLLM(marketData, conditions) && this.llmBudget.canCall()) {
            const recentMemories = await getRecentMemories(5, this.activeSimulationId);
            // Faz 3 (B3-6) — token guard: shrink memory context if the prompt
            // would exceed the model budget; data is never truncated.
            const { prompt, memories } = capPromptTokens(marketData, conditions, recentMemories, aegisConfig.llm.maxTokens * 6);
            try {
                // Faz 3 — tool-calling mode (default on; user can disable).
                // B3-7: models on the exclusion list use the plain prompt path.
                const toolsEnabled = settings.llmToolsEnabled ?? aegisConfig.llm.tools.enabled;
                const modelSupportsTools = supportsTools(settings.activeModel, aegisConfig.llm.tools.excludedModels);
                if (toolsEnabled && modelSupportsTools && this.toolExecutor) {
                    this.toolExecutor.reset();
                    this._lastMarketData = marketData;
                    const response = await runToolAgent({
                        prompt,
                        memoryContext: memories,
                        settings,
                        isCritical: conditions.isCritical,
                        executor: this.toolExecutor,
                        ctx: this._buildToolContext(),
                        maxRounds: aegisConfig.llm.tools.maxRounds,
                        beforeRound: () => this.llmBudget.canCall(),
                    });
                    this.llmBudget.recordCall();
                    this._recordLLMMetric(settings.activeModel, 'tool');
                    return response;
                }

                const response = await callLLM(prompt, conditions.isCritical, memories, settings);
                this.llmBudget.recordCall();
                this._recordLLMMetric(settings.activeModel, 'plain');
                return response;
            } catch (error) {
                const message = `OpenRouter API Error: ${error.message}`;
                this.broadcast('notification', {
                    type: 'error',
                    message,
                    timestamp: new Date().toISOString()
                });
                // C7 — LLM outage is a critical operational event
                this.notifier.notify('error', message).catch(() => {});
                return deterministicFallback(marketData, conditions, simulationState);
            }
        }
        // Hold shortcut — conditions are optimal, save API limits
        return {
            decision: 'hold',
            reasoning: 'Conditions are optimal. Health factor is safe and no profitable actions available. Holding position to save API limits.',
            action: `Scanning Pendle PT-sUSDe pools... Yield spread is optimal. ${marketData.blockNumber ? `(Block: ${marketData.blockNumber})` : ''}`,
            logType: 'scan'
        };
    }

    async runCycle() {
        if (!this.isRunning) return;

        // Phase 4 (D8) — trace the full cycle as one span (no-op when disabled).
        return trace('aegis.cycle', async (span) => {
        // B2.5-7 — stuck-detection watchdog: if the cycle takes longer than
        // cycleWatchdogMs, an alert is broadcast. The timer fires even if the
        // cycle hangs forever (the awaited work never resolves).
        const watchdogMs = aegisConfig.agent.cycleWatchdogMs || 0;
        const watchdog = watchdogMs > 0 ? setTimeout(() => {
            this.logAndBroadcast('alert', `⚠️ [Watchdog] Agent cycle is taking longer than ${watchdogMs / 1000}s — possible stuck execution.`);
        }, watchdogMs) : null;

        try {
            this.llmBudget.beginCycle();

            // 1. Fetch Real Market Data
            let marketData;
            try {
                marketData = await withRetry(() => MarketDataSource.getSnapshot(simulationState, { simulationId: this.activeSimulationId, userId: this.ownerUserId }), { name: 'MarketDataSource.getSnapshot' });
            } catch (error) {
                this.logAndBroadcast('alert', `❌ Oracle API Error: ${error.message}. Postponing execution safely.`);
                return; // Abort cycle safely
            }

            // Persist a real-data snapshot for backtesting / trend analysis
            HistoricalDataService.recordSnapshot(marketData);

            const oracle = {
                pendlePtSusdeApy: marketData.pendlePtSusdeApy,
                morphoBorrowApy: marketData.morphoBorrowApy,
                susdeApy: marketData.susdeApy,
                baseSpread: marketData.baseSpread,
                leverage: marketData.leverage,
                ethPrice: marketData.ethPrice,
                gasPrice: marketData.gasPrice,
            };
            const stats = insertPortfolioStats(
                marketData.portfolio.tvl,
                marketData.portfolio.netApy,
                marketData.portfolio.healthFactor,
                marketData.portfolio.strategies,
                oracle,
                this.activeSimulationId
            );
            this.broadcast('portfolio_update', {
                ...stats,
                ...marketData.portfolio,
                oracleStatus: marketData.oracleStatus
            });

            // 2. Assess risk
            let conditions = evaluateMarketConditions(marketData, this.simulationSettings);

            if (conditions.isCritical) {
                this.logAndBroadcast('alert', `⚠️ CRITICAL: Health Factor dropped below ${conditions.criticalHf} or Yield Inversion detected. Initiating emergency De-leveraging.`);
            }

            // 3. Decide (LLM + guardrails + deterministic fallback)
            const settings = await getSettings(this.ownerUserId);
            let response = await this._makeDecision(marketData, conditions, settings);

            const { response: validated, warnings } = validateLLMDecision(response, marketData, conditions, simulationState);
            for (const warning of warnings) {
                this.logAndBroadcast('alert', warning);
            }
            response = validated;

            // Faz 3 (B3-4) — every decision carries structured, auditable
            // reasoning (LLM-provided or deterministically derived). The
            // details are broadcast + persisted so the UI can explain WHY.
            response = normalizeReasoning(response, marketData, conditions);
            this._lastReasoningDetails = response.reasoningDetails;
            this.logAndBroadcast('decision', `🧠 ${response.decision}: ${response.action || 'No action'}`,
                { reasoning: response.reasoningDetails });

            // 4. Slippage / freshness check before executing
            if (['rebalance', 'claim', 'unwind', 'adjust_portfolio', 'reallocate_capital', 'flash_loan_rescue', 'migrate_borrow', 'cross_chain_migrate'].includes(response.decision)) {
                try {
                    const freshMarketData = await withRetry(() => MarketDataSource.getSnapshot(simulationState, { simulationId: this.activeSimulationId, userId: this.ownerUserId }), { name: 'fetchFreshMarketData' });
                    const hfDiff = Math.abs(freshMarketData.portfolio.healthFactor - marketData.portfolio.healthFactor);

                    // If HF changed by more than 0.05 (5%), abort execution
                    if (hfDiff > 0.05) {
                        this.logAndBroadcast('alert', `⚠️ [Slippage Check] Market conditions changed significantly during LLM decision (HF diff: ${hfDiff.toFixed(2)}). Aborting trade.`);
                        return; // Abort cycle
                    }
                    // Use fresh data for execution
                    marketData = freshMarketData;
                    conditions = evaluateMarketConditions(marketData, this.simulationSettings);
                } catch (e) {
                    this.logAndBroadcast('alert', `⚠️ [Slippage Check] Failed to fetch fresh market data: ${e.message}. Aborting trade for safety.`);
                    return;
                }
            }

            // 5. Execute via the configured execution backend
            // Onchain mode without a configured wallet → read-only cycle:
            // the agent still observes/records, but refuses to broadcast trades.
            if (this.executionMode === 'onchain' && !this.executionReady) {
                if (!this.executionWarningShown) {
                    this.executionWarningShown = true;
                    this.logAndBroadcast('alert', '❌ [Onchain] Execution not ready: no wallet configured (EVM_PROVIDER_URL + EVM_PRIVATE_KEY). Agent runs read-only — no trades will be broadcast.');
                }
                return;
            }
            await this.executionLayer.execute(response, marketData, conditions);
            this._recordCycleMetrics();
            try { span.setAttribute('decision', response.decision); } catch (_) { /* ignore */ }

        } catch (error) {
            this.logAndBroadcast('system', `❌ Error in agent cycle: ${error.message}`);
        } finally {
            if (watchdog) clearTimeout(watchdog);
        }
        });
    }
}
