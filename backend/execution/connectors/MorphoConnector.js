// backend/execution/connectors/MorphoConnector.js
// Thin ethers v6 wrapper around the Morpho Blue contract. Each method returns
// a populated TransactionRequest so the execution layer can decide gas/slippage.
//
// Morpho Blue identifies a market by its full triple (oracle, irm, lltv) plus
// (loanToken, collateralToken). The connector carries an optional `market`
// config; plans that use Morpho MUST supply one, otherwise the execution layer
// refuses (fail-closed — an incomplete market call would revert on-chain).

import { Contract, MaxUint256 } from 'ethers';
import { PROTOCOLS, MORPHO_ABI, MORPHO_READ_ABI, ERC20_ABI } from './protocolConfig.js';

export class MorphoConnector {
    constructor({ provider, signer, chainId, market }) {
        if (!provider) throw new Error('MorphoConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        this.address = PROTOCOLS.morphoBlue.markets[this.chainId];
        if (!this.address) throw new Error(`Morpho Blue not configured for chainId ${this.chainId}`);
        this.market = market || null;
        this.contract = new Contract(this.address, MORPHO_ABI, this.signer);
        this.reader = new Contract(this.address, MORPHO_READ_ABI, this.provider);
    }

    // Market triple from the constructor config or explicit overrides.
    _triple({ oracle, irm, lltv } = {}) {
        if (!this.market) throw new Error('Morpho market not configured (oracle/irm/lltv). Plan must be refused.');
        return {
            oracle: oracle || this.market.oracle,
            irm: irm || this.market.irm,
            lltv: lltv ?? this.market.lltv,
        };
    }

    /**
     * A1 — live position read. Computes the market id from the market params
     * and returns the wallet's position. Returns { supplyShares, borrowShares,
     * collateral, marketId } (BigInts).
     */
    async getPosition({ loanToken, collateralToken, oracle, irm, lltv, user }) {
        const owner = user || await this.signer.getAddress();
        const marketId = await this.reader.id(loanToken, collateralToken, oracle, irm, lltv);
        const position = await this.reader.position(marketId, owner);
        return {
            supplyShares: position.supplyShares,
            borrowShares: position.borrowShares,
            collateral: position.collateral,
            marketId,
        };
    }

    async supply({ loanToken, collateralToken, loanAmount, collateralAmount, ...market }) {
        const onBehalf = await this.signer.getAddress();
        const { oracle, irm, lltv } = this._triple(market);
        return this.contract.supply.populateTransaction(
            loanToken, collateralToken, oracle, irm, lltv, loanAmount, collateralAmount, onBehalf, '0x'
        );
    }

    async borrow({ loanToken, collateralToken, assets, shares = 0, ...market }) {
        const who = await this.signer.getAddress();
        const { oracle, irm, lltv } = this._triple(market);
        return this.contract.borrow.populateTransaction(
            loanToken, collateralToken, oracle, irm, lltv, assets, shares, who, who
        );
    }

    async repay({ loanToken, collateralToken, assets = 0, shares = MaxUint256, ...market }) {
        const onBehalf = await this.signer.getAddress();
        const { oracle, irm, lltv } = this._triple(market);
        return this.contract.repay.populateTransaction(
            loanToken, collateralToken, oracle, irm, lltv, assets, shares, onBehalf, '0x'
        );
    }

    async withdraw({ loanToken, collateralToken, assets = 0, shares = MaxUint256, ...market }) {
        const who = await this.signer.getAddress();
        const { oracle, irm, lltv } = this._triple(market);
        return this.contract.withdraw.populateTransaction(
            loanToken, collateralToken, oracle, irm, lltv, assets, shares, who, who
        );
    }

    async flashLoan({ token, assets, receiverData = '0x' }) {
        return this.contract.flashLoan.populateTransaction(token, assets, receiverData);
    }

    /** A2 — ERC-20 approve to the Morpho Blue core (collateral / loan pulls). */
    async approve({ token, amount = MaxUint256 }) {
        return new Contract(token, ERC20_ABI, this.signer).approve.populateTransaction(this.address, amount);
    }
}
