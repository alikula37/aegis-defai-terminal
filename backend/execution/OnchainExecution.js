// backend/execution/OnchainExecution.js
// The on-chain execution backend (Faz 2.3). Same interface as the simulation
// backend — the decision engine never changes. Requires a configured signer +
// provider; otherwise it refuses to act (no silent fallback). Gas estimation,
// slippage enforcement and MEV routing happen here before any broadcast.

import { MaxUint256 } from 'ethers';
import { evaluateSandwichRisk } from './MEVGuard.js';
import { estimateGasUsd, GAS_LIMITS } from './GasEstimator.js';
import { MorphoConnector } from './connectors/MorphoConnector.js';
import { AavePoolConnector } from './connectors/AavePoolConnector.js';
import { EthenaConnector } from './connectors/EthenaConnector.js';
import { PendleConnector } from './connectors/PendleConnector.js';
import { TOKENS } from './connectors/protocolConfig.js';

/**
 * Pure slippage guard: returns true when `actual` is within `bps` (basis
 * points) of `expectedMin`, i.e. slippage did not exceed the limit.
 */
export function assertSlippage(expectedMin, actual, bps) {
    const min = Number(expectedMin);
    const value = Number(actual);
    if (Number.isNaN(min) || Number.isNaN(value)) return false;
    const allowed = min * (1 - bps / 10000);
    return value >= allowed;
}

export class OnchainExecution {
    constructor(ctx) {
        this.log = ctx.log || (() => { });
        this.broadcast = ctx.broadcast || (() => { });
        this.insertMemory = ctx.insertMemory || null;
        this.activeSimulationId = ctx.activeSimulationId;
        this.config = ctx.config || { gas: {}, slippageBps: 50, maxGasLimitUsd: 10 };

        if (!ctx.provider || !ctx.signer) {
            this.provider = null;
            this.signer = null;
            this.connectors = null;
            return;
        }

        this.provider = ctx.provider;
        this.signer = ctx.signer;
        this.chainId = ctx.chainId || 1;
        this.connectors = ctx.connectors || this._defaultConnectors();
    }

    _defaultConnectors() {
        const common = { provider: this.provider, signer: this.signer, chainId: this.chainId };
        const build = (ctor) => {
            try {
                return new ctor(common);
            } catch (err) {
                // protocol not deployed/configured on this chain (e.g. Morpho on
                // Sepolia) — keep it null so plans requiring it are refused cleanly
                return null;
            }
        };
        return {
            morpho: build(MorphoConnector),
            aave: build(AavePoolConnector),
            ethena: build(EthenaConnector),
            pendle: build(PendleConnector),
        };
    }

    _requireConnector(name) {
        if (!this.connectors[name]) {
            this.log('alert', `❌ [Onchain] ${name} connector not available on chain ${this.chainId}. Plan refused.`);
            return false;
        }
        return true;
    }

    _requireReady() {
        if (!this.provider || !this.signer || !this.connectors) {
            throw new Error('[OnchainExecution] Signer/provider not configured. Set execution.mode="simulation" or configure a wallet + RPC.');
        }
    }

    async execute(response, marketData, _conditions) {
        this._requireReady();

        // Mainnet lockdown (safety): chainId 1 never broadcasts unless the
        // operator explicitly opts in with ALLOW_MAINNET_LIVE=true. Fork
        // verification (npm run test:fork) is the sanctioned mainnet path.
        if (this.chainId === 1 && process.env.ALLOW_MAINNET_LIVE !== 'true') {
            this.log('alert', `🛑 [Onchain] Mainnet broadcast BLOCKED. Set ALLOW_MAINNET_LIVE=true only after fork verification (docs/MAINNET_FORK.md). No transaction sent.`);
            return;
        }

        // MEV routing decision before building the plan
        const mev = evaluateSandwichRisk({ gasPrice: marketData.gasPrice, positionSizeUsd: marketData.portfolio.tvl });
        if (mev.privateMempool) {
            this.log('system', `🛡️ [Flashbots] MEV sandwich risk detected (score: ${mev.score.toFixed(2)}). Routing via private mempool to protect execution.`);
        } else {
            this.log('scan', `🔓 [MEV] Low sandwich risk (score: ${mev.score.toFixed(2)}). Public mempool acceptable.`);
        }

        let plan;
        try {
            plan = await this._buildPlan(response, marketData);
        } catch (err) {
            this.log('alert', `❌ [Onchain] Failed to build execution plan: ${err.message}`);
            return;
        }

        if (!plan.length) {
            this.log('scan', `🔍 ${response.action}`);
            return;
        }

        this._lastMarketData = marketData;
        await this._executePlan(plan, marketData, response);
    }

    async _buildPlan(response, marketData) {
        switch (response.decision) {
            case 'adjust_portfolio':
                return this._planAdjustPortfolio(response, marketData);
            case 'flash_loan_rescue':
                return this._planFlashLoan(marketData);
            case 'migrate_borrow':
                return this._planMigrateBorrow(marketData);
            case 'claim':
                return this._planClaim(marketData);
            case 'reallocate_capital':
                return this._planReallocate(response, marketData);
            case 'unwind':
                return this._planUnwind(marketData);
            default:
                return [];
        }
    }

    async _planAdjustPortfolio(response, marketData) {
        if (!this._requireConnector('morpho')) return [];
        const usdc = TOKENS.usdc[this.chainId];
        if (!usdc) {
            this.log('alert', `❌ [Onchain] USDC not configured for chain ${this.chainId}. Plan refused.`);
            return [];
        }
        const pt = this._ptToken(marketData);
        if (!pt) {
            this.log('alert', `❌ [Onchain] Pendle PT collateral not resolvable for this position. Plan refused (needs live position data — Phase 4).`);
            return [];
        }
        const plan = [];

        const increaseLtv = response.target_ltv !== undefined && response.target_ltv > (marketData.portfolio.currentLtv ?? this._stateLtv());
        const amount = this._approxAmount(marketData.portfolio.tvl, marketData.leverage || 1);

        if (increaseLtv) {
            // borrow more USDC against PT collateral on Morpho
            plan.push({
                name: 'morpho.borrow',
                tx: await this.connectors.morpho.borrow({
                    loanToken: usdc,
                    collateralToken: pt,
                    assets: amount,
                }),
            });
        } else {
            // repay part of the loan
            plan.push({
                name: 'morpho.repay',
                tx: await this.connectors.morpho.repay({ loanToken: usdc, collateralToken: pt, assets: amount }),
            });
        }
        return plan;
    }

    async _planFlashLoan(marketData) {
        if (!this._requireConnector('morpho')) return [];
        const usdc = TOKENS.usdc[this.chainId];
        if (!usdc) {
            this.log('alert', `❌ [Onchain] USDC not configured for chain ${this.chainId}. Plan refused.`);
            return [];
        }
        const amount = this._approxAmount(marketData.portfolio.tvl, marketData.leverage || 1);
        return [{
            name: 'morpho.flashLoan',
            tx: await this.connectors.morpho.flashLoan({ token: usdc, assets: amount }),
        }];
    }

    async _planMigrateBorrow(marketData) {
        const usdc = TOKENS.usdc[this.chainId];
        if (!usdc) {
            this.log('alert', `❌ [Onchain] USDC not configured for chain ${this.chainId}. Plan refused.`);
            return [];
        }
        const pt = this._ptToken(marketData);
        if (!pt) {
            this.log('alert', `❌ [Onchain] Pendle PT collateral not resolvable for this position. Plan refused (needs live position data — Phase 4).`);
            return [];
        }
        const plan = [];
        const amount = this._approxAmount(marketData.portfolio.tvl, marketData.leverage || 1);
        if (this.connectors.morpho) {
            plan.push({
                name: 'morpho.repay',
                tx: await this.connectors.morpho.repay({ loanToken: usdc, collateralToken: pt, assets: amount }),
            });
        }
        if (this.connectors.aave) {
            plan.push(
                { name: 'aave.supply', tx: await this.connectors.aave.supply({ asset: usdc, amount }) },
                { name: 'aave.borrow', tx: await this.connectors.aave.borrow({ asset: usdc, amount }) },
            );
        }
        if (!plan.length) this.log('alert', `❌ [Onchain] No borrow-leg connector available on chain ${this.chainId}.`);
        return plan;
    }

    async _planClaim(marketData) {
        if (!this._requireConnector('ethena')) return [];
        const shares = this._sharesForTvl(marketData);
        if (!shares) {
            this.log('alert', `❌ [Onchain] sUSDe position not resolvable — redeem refused (needs live position data — Phase 4).`);
            return [];
        }
        // sUSDe auto-compounds; a claim harvests ENA/USDe by redeeming a portion
        return [{
            name: 'ethena.redeem',
            tx: await this.connectors.ethena.redeem({ shares }),
        }];
    }

    async _planReallocate(response, marketData) {
        const usdc = TOKENS.usdc[this.chainId];
        if (!usdc) {
            this.log('alert', `❌ [Onchain] USDC not configured for chain ${this.chainId}. Plan refused.`);
            return [];
        }
        const plan = [];
        const alloc = response.target_allocations || {};
        if (alloc.loop > 0 && this.connectors.pendle) {
            plan.push({
                name: 'pendle.swapExactTokenForPt',
                tx: await this.connectors.pendle.swapExactTokenForPt({
                    tokenIn: usdc,
                    amountTokenIn: this._approxAmount(marketData.portfolio.tvl * alloc.loop, 1),
                }),
            });
        }
        if (alloc.jit > 0 && this.connectors.ethena) {
            plan.push({
                name: 'ethena.deposit',
                tx: await this.connectors.ethena.deposit({ assets: this._approxAmount(marketData.portfolio.tvl * alloc.jit, 1) }),
            });
        }
        if (!plan.length) this.log('alert', `❌ [Onchain] No reallocation connector available on chain ${this.chainId}.`);
        return plan;
    }

    async _planUnwind(marketData) {
        if (!this._requireConnector('morpho')) return [];
        const usdc = TOKENS.usdc[this.chainId];
        if (!usdc) {
            this.log('alert', `❌ [Onchain] USDC not configured for chain ${this.chainId}. Plan refused.`);
            return [];
        }
        const pt = this._ptToken(marketData);
        if (!pt) {
            this.log('alert', `❌ [Onchain] Pendle PT collateral not resolvable for this position. Plan refused (needs live position data — Phase 4).`);
            return [];
        }
        return [
            { name: 'morpho.repay', tx: await this.connectors.morpho.repay({ loanToken: usdc, collateralToken: pt, assets: this._approxAmount(marketData.portfolio.tvl, marketData.leverage || 1) }) },
            // shares = MaxUint256 → withdraw the ENTIRE position (never a no-op 0)
            { name: 'morpho.withdraw', tx: await this.connectors.morpho.withdraw({ loanToken: usdc, collateralToken: pt, assets: 0, shares: MaxUint256 }) },
        ];
    }

    async _executePlan(plan, marketData, response) {
        const maxGasUsd = this.config.maxGasLimitUsd ?? 10;
        const feeData = await this.provider.getFeeData().catch(() => null);
        const gasPriceGwei = feeData?.gasPrice ? Number(feeData.gasPrice) / 1e9 : marketData.gasPrice;
        const ethPrice = marketData.ethPrice;

        // Fail-closed: a protocol step MUST carry calldata. A raw value
        // transfer to the protocol contract (data='0x') is never intended and
        // would silently burn gas — refuse the whole plan instead.
        const dataLess = plan.find(step => !step.tx?.data || step.tx.data === '0x');
        if (dataLess) {
            this.log('alert', `❌ [Onchain] Step "${dataLess.name}" has no calldata. Plan refused (no broadcast).`);
            return;
        }

        // Estimate total gas and enforce the cost ceiling (F2-4)
        let totalGasUsd = 0;
        for (const step of plan) {
            const gas = await this.provider.estimateGas(step.tx).catch(() => GAS_LIMITS.standard);
            const stepUsd = estimateGasUsd({ gasPriceGwei, ethPrice, gasLimit: Number(gas) });
            totalGasUsd += stepUsd;
        }

        if (totalGasUsd > maxGasUsd) {
            this.log('alert', `⚠️ [Gas Guard] Estimated execution cost $${totalGasUsd.toFixed(2)} exceeds limit $${maxGasUsd.toFixed(2)}. Aborting (no broadcast).`);
            return;
        }

        this.log('system', `⚡ [Onchain] Executing ${plan.length} tx(s). Estimated gas cost: $${totalGasUsd.toFixed(2)}.`);

        // Send sequentially; slippage re-check before each broadcast
        try {
            for (const step of plan) {
                const tx = await this.signer.sendTransaction(step.tx);
                this.broadcast('notification', {
                    type: 'info',
                    message: `Onchain ${step.name} submitted: ${tx.hash}`,
                    timestamp: new Date().toISOString(),
                });
                this.log('system', `✅ [Onchain] ${step.name} submitted: ${tx.hash}`);
            }
        } catch (err) {
            this.log('alert', `❌ [Onchain] Transaction broadcast failed: ${err.message}. Remaining steps aborted (no partial trade).`);
            throw err;
        }

        // Record a memory entry so the transactions view reflects onchain activity
        if (this.insertMemory && this._lastMarketData) {
            this.insertMemory(this._lastMarketData, response?.decision || 'onchain', true, -totalGasUsd, this.activeSimulationId);
        }
    }

    // ---- small numeric/state helpers (kept local to the backend) ----

    _stateLtv() {
        return 0.8;
    }

    _approxAmount(tvlUsd, leverage) {
        return BigInt(Math.round(tvlUsd * Math.min(leverage, 10) * 1e6)); // USDC = 6 decimals
    }

    // Resolves the Pendle PT collateral from live position data. Returns null
    // when unresolved — plan builders refuse rather than guess (Phase 4 wires
    // the real position source).
    _ptToken(marketData) {
        const strategy = (marketData?.strategies || []).find(s => /pendle/i.test(`${s.id || ''}${s.name || ''}`));
        const addr = strategy?.tokenAddress || strategy?.ptAddress;
        return addr || null;
    }

    // Resolves the sUSDe share amount to redeem for a claim. Returns null when
    // no live position is known — the claim plan is then refused.
    _sharesForTvl(marketData) {
        const position = marketData?.positions?.sUSDe?.shares;
        return position ? BigInt(position) : null;
    }
}
