// backend/execution/connectors/EthenaConnector.js
// Thin ethers v6 wrapper around StakedUSDe (sUSDe) deposit/redeem.

import { Contract } from 'ethers';
import { PROTOCOLS, SUSDE_ABI } from './protocolConfig.js';

export class EthenaConnector {
    constructor({ provider, signer, chainId }) {
        if (!provider) throw new Error('EthenaConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        this.address = PROTOCOLS.sUSDe.markets[this.chainId];
        if (!this.address) throw new Error(`sUSDe not configured for chainId ${this.chainId}`);
        this.contract = new Contract(this.address, SUSDE_ABI, this.signer);
    }

    async deposit({ assets }) {
        const receiver = await this.signer.getAddress();
        return this.contract.deposit.populateTransaction(assets, receiver);
    }

    async redeem({ shares }) {
        const who = await this.signer.getAddress();
        return this.contract.redeem.populateTransaction(shares, who, who);
    }

    async approve({ spender, amount }) {
        return this.contract.approve.populateTransaction(spender, amount);
    }

    /** A1 — live sUSDe balance (shares held by the signer). */
    async getBalance(user) {
        const owner = user || await this.signer.getAddress();
        return this.contract.balanceOf(owner);
    }
}
