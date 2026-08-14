// backend/execution/connectors/AavePoolConnector.js
// Thin ethers v6 wrapper around the Aave Pool contract (V3 interface — see
// protocolConfig for the Aave V4 note). Methods return populated tx requests.

import { Contract, MaxUint256, getAddress } from 'ethers';
import { PROTOCOLS, AAVE_POOL_ABI, AAVE_POOL_READ_ABI, ERC20_ABI } from './protocolConfig.js';

export const STABLE_RATE = 1;
export const VARIABLE_RATE = 2;

export class AavePoolConnector {
    constructor({ provider, signer, chainId }) {
        if (!provider) throw new Error('AavePoolConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        this.address = PROTOCOLS.aavePool.markets[this.chainId];
        if (!this.address) throw new Error(`Aave Pool not configured for chainId ${this.chainId}`);
        this.contract = new Contract(this.address, AAVE_POOL_ABI, this.signer);
    }

    async supply({ asset, amount, value }) {
        const onBehalfOf = await this.signer.getAddress();
        const overrides = value !== undefined ? { value } : undefined;
        return overrides
            ? this.contract.supply.populateTransaction(asset, amount, onBehalfOf, 0, overrides)
            : this.contract.supply.populateTransaction(asset, amount, onBehalfOf, 0);
    }

    async borrow({ asset, amount, rateMode = VARIABLE_RATE, referralCode = 0 }) {
        const onBehalfOf = await this.signer.getAddress();
        return this.contract.borrow.populateTransaction(asset, amount, rateMode, referralCode, onBehalfOf);
    }

    async repay({ asset, amount, rateMode = VARIABLE_RATE }) {
        const onBehalfOf = await this.signer.getAddress();
        return this.contract.repay.populateTransaction(asset, amount, rateMode, onBehalfOf);
    }

    async withdraw({ asset, amount, to }) {
        const receiver = to || await this.signer.getAddress();
        return this.contract.withdraw.populateTransaction(asset, amount, receiver);
    }

    /** A2 — ERC-20 approve to the Aave Pool (supply/repay pull tokens). */
    async approve({ asset, amount = MaxUint256 }) {
        return new Contract(getAddress(asset), ERC20_ABI, this.signer).approve.populateTransaction(this.address, amount);
    }

    /** A1 — live aToken balance for an asset (e.g. aWETH). */
    async getATokenBalance(asset, user) {
        const owner = getAddress(user || await this.signer.getAddress());
        const data = await new Contract(this.address, AAVE_POOL_READ_ABI, this.provider).getReserveData(asset);
        const aToken = new Contract(data.aTokenAddress, ERC20_ABI, this.provider);
        return aToken.balanceOf(owner);
    }

    /** A1 — live variable debt balance for an asset (e.g. borrowed USDC). */
    async getVariableDebt(asset, user) {
        const owner = getAddress(user || await this.signer.getAddress());
        const data = await new Contract(this.address, AAVE_POOL_READ_ABI, this.provider).getReserveData(asset);
        const debtToken = new Contract(data.variableDebtTokenAddress, ERC20_ABI, this.provider);
        return debtToken.balanceOf(owner);
    }
}
