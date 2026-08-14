// backend/execution/connectors/MorphoConnector.js
// Thin ethers v6 wrapper around the Morpho Blue contract. Each method returns
// a populated TransactionRequest so the execution layer can decide gas/slippage.

import { Contract, MaxUint256 } from 'ethers';
import { PROTOCOLS, MORPHO_ABI } from './protocolConfig.js';

export class MorphoConnector {
    constructor({ provider, signer, chainId }) {
        if (!provider) throw new Error('MorphoConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        this.address = PROTOCOLS.morphoBlue.markets[this.chainId];
        if (!this.address) throw new Error(`Morpho Blue not configured for chainId ${this.chainId}`);
        this.contract = new Contract(this.address, MORPHO_ABI, this.signer);
    }

    async supply({ loanToken, collateralToken, loanAmount, collateralAmount }) {
        const onBehalf = await this.signer.getAddress();
        return this.contract.supply.populateTransaction(
            loanToken, collateralToken, loanAmount, collateralAmount, onBehalf, '0x'
        );
    }

    async borrow({ loanToken, collateralToken, assets, shares = 0 }) {
        const who = await this.signer.getAddress();
        return this.contract.borrow.populateTransaction(loanToken, collateralToken, assets, shares, who, who);
    }

    async repay({ loanToken, collateralToken, assets, shares = MaxUint256 }) {
        const onBehalf = await this.signer.getAddress();
        return this.contract.repay.populateTransaction(loanToken, collateralToken, assets, shares, onBehalf, '0x');
    }

    async withdraw({ loanToken, collateralToken, assets, shares = 0 }) {
        const who = await this.signer.getAddress();
        return this.contract.withdraw.populateTransaction(loanToken, collateralToken, assets, shares, who, who);
    }

    async flashLoan({ token, assets, receiverData = '0x' }) {
        return this.contract.flashLoan.populateTransaction(token, assets, receiverData);
    }

    async approveToken({ tokenContract, spender, amount = MaxUint256 }) {
        return tokenContract.approve.populateTransaction(spender, amount);
    }
}
