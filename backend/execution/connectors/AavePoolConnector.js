// backend/execution/connectors/AavePoolConnector.js
// Thin ethers v6 wrapper around the Aave Pool contract (V3 interface — see
// protocolConfig for the Aave V4 note). Methods return populated tx requests.

import { Contract } from 'ethers';
import { PROTOCOLS, AAVE_POOL_ABI } from './protocolConfig.js';

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
}
