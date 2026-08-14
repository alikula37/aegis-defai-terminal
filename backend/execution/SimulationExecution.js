// backend/execution/SimulationExecution.js
// The simulation execution backend. Mirrors the legacy executeTrade behavior in
// agent.js (Faz 2.3). All state mutation happens through the shared ctx object,
// so the exact same decision, when routed here, produces identical outcomes.

import { randomRange } from '../utils/rng.js';
import { estimateMulticallGas } from './GasEstimator.js';
import { evaluateSandwichRisk } from './MEVGuard.js';

const ACTIONABLE_DECISIONS = [
    'rebalance',
    'claim',
    'unwind',
    'adjust_portfolio',
    'reallocate_capital',
    'flash_loan_rescue',
    'migrate_borrow',
    'cross_chain_migrate',
];

const MULTI_STEP_DECISIONS = [
    'rebalance',
    'de_leverage',
    'migrate_borrow',
    'cross_chain_migrate',
    'adjust_portfolio',
    'reallocate_capital',
    'flash_loan_rescue',
];

export class SimulationExecution {
    constructor(ctx) {
        this.ctx = ctx;
        this._pendingTimers = new Set();
    }

    get state() { return this.ctx.state; }

    // Deferred (3s) stats write. Tracked so stopSimulation can cancel stale
    // writes that would otherwise land after the next simulation has started.
    _defer(simId, fn) {
        const timer = setTimeout(() => {
            this._pendingTimers.delete(timer);
            try {
                fn();
            } catch (err) {
                this.ctx.log?.('alert', `⚠️ Deferred portfolio write failed: ${err.message}`);
            }
        }, 3000);
        this._pendingTimers.add(timer);
    }

    dispose() {
        for (const timer of this._pendingTimers) clearTimeout(timer);
        this._pendingTimers.clear();
    }

    isActionable(decision) {
        return ACTIONABLE_DECISIONS.includes(decision);
    }

    async execute(response, marketData, conditions) {
        const { log, cooldowns } = this.ctx;
        const { hourlyYield, gasCostUsd } = conditions;
        const decision = response.decision;

        if (!this.isActionable(decision)) {
            log('scan', `🔍 ${response.action}`);
            return;
        }

        // Record cooldown
        cooldowns[decision] = Date.now();

        // ---- MEV routing decision ----
        const positionSizeUsd = marketData.portfolio.tvl;
        const mev = evaluateSandwichRisk({ gasPrice: marketData.gasPrice, positionSizeUsd });

        if (mev.privateMempool) {
            log('system', `🛡️ [Flashbots] MEV sandwich risk detected (score: ${mev.score.toFixed(2)}). Routing via private mempool to protect execution.`);
            await new Promise(r => setTimeout(r, 500));
            log('system', `✅ [Flashbots] Transaction submitted to private bundle. Sandwich protection active.`);
        } else {
            log('scan', `🔓 [MEV] Low sandwich risk (score: ${mev.score.toFixed(2)}). Public mempool acceptable.`);
        }

        // ---- Multicall batching (gas optimization) ----
        let effectiveGasCostUsd = gasCostUsd;
        if (MULTI_STEP_DECISIONS.includes(decision)) {
            const numCalls = decision === 'cross_chain_migrate' ? 4 : 3;
            const mc = estimateMulticallGas({ gasCostUsd, numCalls });
            effectiveGasCostUsd = mc.batched;
            log('system', `⚡ [Multicall3] Batching ${numCalls} calls into 1 atomic tx. Gas: $${mc.sequential.toFixed(2)} → $${mc.batched.toFixed(2)} (saved $${mc.saved.toFixed(2)}).`);
        }

        await this._handleDecision(response, marketData, conditions, effectiveGasCostUsd, hourlyYield);
    }

    async _handleDecision(response, marketData, conditions, effectiveGasCostUsd, hourlyYield) {
        if (response.decision === 'adjust_portfolio') {
            await this._adjustPortfolio(response, marketData, conditions, effectiveGasCostUsd);
        } else if (response.decision === 'reallocate_capital') {
            this._reallocateCapital(response, marketData, effectiveGasCostUsd);
        } else if (response.decision === 'flash_loan_rescue') {
            this._flashLoanRescue(marketData, conditions, effectiveGasCostUsd, hourlyYield);
        } else if (response.decision === 'claim') {
            this._claim(response, marketData, conditions, effectiveGasCostUsd);
        } else if (response.decision === 'unwind') {
            this._unwind(response, marketData, conditions, effectiveGasCostUsd, hourlyYield);
        } else if (response.decision === 'migrate_borrow') {
            this._migrateBorrow(marketData, conditions, effectiveGasCostUsd);
        } else if (response.decision === 'cross_chain_migrate') {
            await this._crossChainMigrate(marketData, effectiveGasCostUsd);
        }
    }

    async _adjustPortfolio(response, marketData, conditions, effectiveGasCostUsd) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        let actionTaken = false;

        // Handle Collateral Switch
        if (response.target_collateral && response.target_collateral !== state.currentCollateral) {
            log('system', `🔄 Switching collateral from ${state.currentCollateral} to ${response.target_collateral}.`);
            state.currentCollateral = response.target_collateral;
            actionTaken = true;
            marketData.portfolio.tvl -= effectiveGasCostUsd * 1.5;
        }

        // Handle LTV Adjustment
        if (response.target_ltv !== undefined && Math.abs(response.target_ltv - state.currentLtv) > 0.01) {
            log('de_leverage', `📉 Adjusting LTV from ${(state.currentLtv * 100).toFixed(1)}% to ${(response.target_ltv * 100).toFixed(1)}%.`);
            state.currentLtv = Math.max(0, Math.min(0.90, response.target_ltv));
            actionTaken = true;
            marketData.portfolio.tvl -= effectiveGasCostUsd;
        }

        if (actionTaken) {
            insertMemory(marketData, response.decision, true, -effectiveGasCostUsd, activeSimulationId);
            this._defer(activeSimulationId, () => {
                const recoveredStats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, conditions.targetHf, marketData.portfolio.strategies, null, activeSimulationId);
                broadcast('portfolio_update', { ...recoveredStats, ...marketData.portfolio, healthFactor: conditions.targetHf });
                log('system', `✅ Portfolio adjustment successful.`);
            });
        }
    }

    _reallocateCapital(response, marketData, effectiveGasCostUsd) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        if (response.target_allocations) {
            const { loop, basis, jit } = response.target_allocations;
            if (Math.abs(loop + basis + jit - 1.0) < 0.01) {
                log('system', `🔄 Reallocating capital: Loop ${(loop * 100).toFixed(0)}%, Basis ${(basis * 100).toFixed(0)}%, JIT ${(jit * 100).toFixed(0)}%`);

                const allocDiff = Math.abs(loop - state.allocations.loop) +
                    Math.abs(basis - state.allocations.basis) +
                    Math.abs(jit - state.allocations.jit);

                const reallocationCost = (allocDiff / 2) * (effectiveGasCostUsd * 2 + 30);

                state.allocations = { loop, basis, jit };
                marketData.portfolio.tvl -= reallocationCost;

                insertMemory(marketData, response.decision, true, -reallocationCost, activeSimulationId);
                const stats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, marketData.portfolio.healthFactor, marketData.portfolio.strategies, null, activeSimulationId);
                broadcast('portfolio_update', { ...stats, ...marketData.portfolio });
                log('system', `✅ Capital reallocation complete. Cost: $${reallocationCost.toFixed(2)}`);
            } else {
                log('alert', `⚠️ [Guardrail] Invalid target allocations (sum != 1.0). Overriding to hold.`);
            }
        }
    }

    _flashLoanRescue(marketData, conditions, effectiveGasCostUsd, hourlyYield) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        state.currentLtv = 0;
        log('flash_loan', `🚨 CRITICAL: Executing Flash Loan Rescue. LTV reset to 0%.`);
        const grossProfit = (hourlyYield * 0.2) * (randomRange(1, 6));
        const pnl = grossProfit - effectiveGasCostUsd;
        marketData.portfolio.tvl += pnl;
        insertMemory(marketData, 'flash_loan_rescue', true, pnl, activeSimulationId);
        this._defer(activeSimulationId, () => {
            const recoveredStats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, conditions.targetHf, marketData.portfolio.strategies, null, activeSimulationId);
            broadcast('portfolio_update', { ...recoveredStats, ...marketData.portfolio, healthFactor: conditions.targetHf });
            log('system', `✅ Flash Loan Rescue successful. Health factor restored to target ${conditions.targetHf}.`);
        });
    }

    _claim(response, marketData, conditions, effectiveGasCostUsd) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        log('claim', `💰 ${response.action} (${response.reasoning})`);
        const pnl = -effectiveGasCostUsd;
        marketData.portfolio.tvl += pnl;
        insertMemory(marketData, response.decision, true, pnl, activeSimulationId);
        const stats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, marketData.portfolio.healthFactor, marketData.portfolio.strategies, null, activeSimulationId);
        broadcast('portfolio_update', { ...stats, ...marketData.portfolio });
    }

    _unwind(response, marketData, conditions, effectiveGasCostUsd, hourlyYield) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        state.currentLtv = 0;
        log('alert', `🚨 ${response.action} (${response.reasoning})`);
        const grossCost = (hourlyYield * 2) * (1 + randomRange(0, 0.5));
        const pnl = -(grossCost + effectiveGasCostUsd);
        marketData.portfolio.tvl += pnl;
        insertMemory(marketData, response.decision, true, pnl, activeSimulationId);
        const stats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, marketData.portfolio.healthFactor, marketData.portfolio.strategies, null, activeSimulationId);
        broadcast('portfolio_update', { ...stats, ...marketData.portfolio });
    }

    _migrateBorrow(marketData, conditions, effectiveGasCostUsd) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        state.currentBorrowProtocol = 'Aave V4 E-Mode';
        const savingsApy = marketData.morphoBorrowApy - marketData.aaveV4BorrowApy;
        log('migrate', `🔄 [Borrow Migration] Moving borrow leg: Morpho Blue → Aave V4 E-Mode`);
        log('migrate', `📊 Saving ${savingsApy.toFixed(2)}% APY on borrowing. Estimated annual gain: $${((savingsApy / 100) * marketData.portfolio.tvl * (marketData.leverage - 1)).toFixed(0)}.`);
        const migrationGas = effectiveGasCostUsd * 1.3;
        const pnl = -migrationGas;
        marketData.portfolio.tvl += pnl;
        insertMemory(marketData, 'migrate_borrow', true, pnl, activeSimulationId);
        const stats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, marketData.portfolio.healthFactor, marketData.portfolio.strategies, null, activeSimulationId);
        broadcast('portfolio_update', { ...stats, ...marketData.portfolio });
        log('system', `✅ [Borrow Migration] Complete. Borrow protocol: Morpho Blue → Aave V4 E-Mode. New borrow rate: ${marketData.aaveV4BorrowApy.toFixed(2)}%.`);
    }

    async _crossChainMigrate(marketData, effectiveGasCostUsd) {
        const { log, broadcast, insertMemory, insertPortfolioStats, activeSimulationId } = this.ctx;
        const state = this.state;
        const cc = marketData.crossChain;
        state.currentBorrowChain = cc.crossChainNetwork;
        log('migrate', `🌉 [Cross-Chain Arb] Evaluating borrow migration to ${cc.crossChainNetwork}`);
        log('migrate', `📊 L1 borrow: ${marketData.bestBorrowApy.toFixed(2)}% → ${cc.crossChainNetwork}: ${cc.bestCrossChainBorrowApy.toFixed(2)}% (save ${cc.crossChainSavings.toFixed(2)}% APY)`);
        log('system', `⏳ [CCIP Bridge] Submitting via Chainlink CCIP... estimated 3 min bridge time.`);
        await new Promise(r => setTimeout(r, 1500));
        log('system', `✅ [CCIP Bridge] Confirmed. PT-sUSDe collateral bridged to ${cc.crossChainNetwork}.`);
        const pnl = -(effectiveGasCostUsd + cc.bridgeCostUsd);
        marketData.portfolio.tvl += pnl;
        insertMemory(marketData, 'cross_chain_migrate', pnl > 0, pnl, activeSimulationId);
        const stats = insertPortfolioStats(marketData.portfolio.tvl, marketData.portfolio.netApy, marketData.portfolio.healthFactor, marketData.portfolio.strategies, null, activeSimulationId);
        broadcast('portfolio_update', { ...stats, ...marketData.portfolio });
        if (pnl > 0) {
            log('system', `✅ [Cross-Chain Arb] Net PnL: +$${pnl.toFixed(2)}. Borrow cost reduced from ${marketData.bestBorrowApy.toFixed(2)}% → ${cc.bestCrossChainBorrowApy.toFixed(2)}%.`);
        } else {
            log('alert', `⚠️ [Cross-Chain Arb] Bridge costs exceeded savings ($${pnl.toFixed(2)}). Position too small for cross-chain migration.`);
        }
    }
}
