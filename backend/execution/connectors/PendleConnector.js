// backend/execution/connectors/PendleConnector.js
// Pendle integration. PT (principal token) positions are ERC-20 tokens; swaps
// and PT/YT minting go through the Pendle Router. This connector exposes the
// router interaction and standard ERC-20 helpers for PT collateral.

import { Contract, MaxUint256 } from 'ethers';
import { PROTOCOLS, ERC20_ABI } from './protocolConfig.js';

const PENDLE_ROUTER_ABI = [
    ...ERC20_ABI,
    'function swapExactTokenForPt(address receiver, bytes market, uint256 minPtOut, bytes guessPtReceived, address[] tokenIn, uint256 amountTokenIn)',
];

export class PendleConnector {
    constructor({ provider, signer, chainId, market }) {
        if (!provider) throw new Error('PendleConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        this.market = market;
        this.routerAddress = PROTOCOLS.pendleRouter.markets[this.chainId];
        if (!this.routerAddress) throw new Error(`Pendle Router not configured for chainId ${this.chainId}`);
        this.router = new Contract(this.routerAddress, PENDLE_ROUTER_ABI, this.signer);
    }

    async swapExactTokenForPt({ receiver, minPtOut = 0, tokenIn, amountTokenIn }) {
        return this.router.swapExactTokenForPt.populateTransaction(
            receiver || await this.signer.getAddress(),
            this.market,
            minPtOut,
            '0x',
            tokenIn,
            amountTokenIn
        );
    }

    ptContract(ptTokenAddress) {
        return new Contract(ptTokenAddress, ERC20_ABI, this.signer);
    }

    async approvePt({ ptTokenAddress, spender, amount }) {
        const pt = this.ptContract(ptTokenAddress);
        return pt.approve.populateTransaction(spender, amount);
    }

    /** A2 — ERC-20 approve to the Pendle Router (swap pulls tokenIn). */
    async approveToken({ token, amount = MaxUint256 }) {
        return new Contract(token, ERC20_ABI, this.signer).approve.populateTransaction(this.routerAddress, amount);
    }
}
