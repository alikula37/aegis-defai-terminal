import { describe, it, expect } from 'vitest';
import dotenv from 'dotenv';
import { JsonRpcProvider, Wallet, Contract, parseEther, parseUnits, formatUnits, MaxUint256, getAddress } from 'ethers';
import { AavePoolConnector } from '../../execution/connectors/AavePoolConnector.js';
import { PROTOCOLS, ERC20_ABI } from '../../execution/connectors/protocolConfig.js';

dotenv.config();

// Full Aave V3 lifecycle on the REAL Sepolia testnet: wrap → approve →
// supply → borrow → repay → withdraw → unwrap. This exercises the exact
// connector paths the agent uses for borrow-migration and rescue plans.
//
// The market was redeployed with NEW reserve token addresses (2026-08), so the
// suite discovers the active USDC/WETH reserve contracts at runtime via
// getReservesList() and skips itself when they are not present.

const RPC_URL = process.env.EVM_PROVIDER_URL;
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const CHAIN_ID = 11155111;

const POOL_ABI = [
    'function getReservesList() view returns (address[])',
    'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt) data)',
];

const WETH_ABI = [
    ...ERC20_ABI,
    'function symbol() view returns (string)',
    'function deposit() payable',
    'function withdraw(uint256 wad)',
];

const ERC20_SYMBOL_ABI = [...ERC20_ABI, 'function symbol() view returns (string)'];

let reservesActive = false;
let USDC = null;
let WETH = null;
let provider;
let wallet;
let pool;

async function probeReserves() {
    // Retry once after a short pause: RPC hiccups on free-tier endpoints would
    // otherwise silently skip the whole suite.
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const list = (await pool.getReservesList()).map(getAddress);
            // Discover reserve contracts by symbol — robust against re-deployments
            for (const asset of list) {
                const token = new Contract(asset, ERC20_SYMBOL_ABI, provider);
                const symbol = await token.symbol().catch(() => null);
                if (symbol === 'USDC' && !USDC) USDC = asset;
                if (symbol === 'WETH' && !WETH) WETH = asset;
            }
            reservesActive = Boolean(USDC && WETH);
            return list;
        } catch (err) {
            if (attempt === 1) {
                console.log(`[aave] reserves probe attempt 1 failed: ${err.message.slice(0, 100)} — retrying...`);
                await new Promise(r => setTimeout(r, 3000));
            } else {
                throw err;
            }
        }
    }
    return [];
}

try {
    provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
    wallet = new Wallet(PRIVATE_KEY, provider);
    pool = new Contract(getAddress(PROTOCOLS.aavePool.markets[CHAIN_ID]), POOL_ABI, provider);

    const list = await probeReserves();
    console.log(`[aave] reserves probe: ${list.length} active (USDC=${reservesActive ? getAddress(USDC).slice(0, 8) : 'missing'}, WETH=${reservesActive ? getAddress(WETH).slice(0, 8) : 'missing'})`);
} catch (err) {
    console.log(`[aave] reserves probe failed: ${err.message.slice(0, 100)}`);
}

// The shared funded wallet is only a gas funder now. Each run spins a FRESH
// sub-wallet funded with SepETH, so a leftover debt on the shared wallet (a
// documented MaxUint256-repay trap) can never poison the suite again.
let subWallet = null;
const subFundAmount = parseEther('0.05');
async function getSubWallet() {
    if (subWallet) return subWallet;
    subWallet = Wallet.createRandom().connect(provider);
    const funding = await wallet.sendTransaction({
        to: subWallet.address,
        value: subFundAmount,
    });
    const receipt = await funding.wait();
    if (receipt.status !== 1) throw new Error('Failed to fund sub-wallet');
    console.log(`[aave] fresh sub-wallet ${subWallet.address.slice(0, 10)}… funded with ${formatUnits(subFundAmount, 18)} SepETH`);
    return subWallet;
}

const suite = reservesActive ? describe : describe.skip;

suite('Aave V3 Sepolia — supply/borrow lifecycle (real transactions)', () => {
    it('wraps ETH, supplies WETH, borrows USDC, repays and withdraws (full loop)', async () => {
        const signer = await getSubWallet();
        const aave = new AavePoolConnector({ provider, signer, chainId: CHAIN_ID });
        const subWeth = new Contract(WETH, WETH_ABI, signer);
        const subUsdc = new Contract(USDC, ERC20_ABI, signer);

        // Pre-flight: the FRESH wallet is debt-free by construction (no
        // MaxUint256-repay trap — a residual debt can never be repaid without
        // external USDC).
        const preUsdcReserve = await pool.getReserveData(USDC);
        const preDebtToken = new Contract(preUsdcReserve.variableDebtTokenAddress, ERC20_ABI, provider);
        const preDebt = await preDebtToken.balanceOf(signer.address);
        expect(preDebt).toBe(0n);

        const wrapAmount = parseEther('0.004');
        const borrowAmount = parseUnits('2', 6); // 2 USDC (6 decimals)

        const ethBefore = await provider.getBalance(signer.address);
        const wethBefore = await subWeth.balanceOf(signer.address);
        const usdcBefore = await subUsdc.balanceOf(signer.address);
        expect(wethBefore).toBe(0n);
        expect(usdcBefore).toBe(0n);

        // 1. wrap ETH → WETH
        const wrapTx = await subWeth.deposit({ value: wrapAmount });
        const wrapReceipt = await wrapTx.wait();
        expect(wrapReceipt.status).toBe(1);

        // 2. approve the pool for WETH
        const approveTx = await subWeth.approve(pool.target, MaxUint256);
        const approveReceipt = await approveTx.wait();
        expect(approveReceipt.status).toBe(1);
        expect(await subWeth.allowance(signer.address, pool.target)).toBe(MaxUint256);

        // 3. supply WETH via the agent connector
        const supplyTx = await signer.sendTransaction(await aave.supply({ asset: WETH, amount: wrapAmount }));
        const supplyReceipt = await supplyTx.wait();
        expect(supplyReceipt.status).toBe(1);

        // 4. verify the aToken balance arrived on-chain
        const wethReserve = await pool.getReserveData(WETH);
        const aToken = new Contract(wethReserve.aTokenAddress, ERC20_ABI, provider);
        const aBalance = await aToken.balanceOf(signer.address);
        expect(aBalance).toBeGreaterThan(0n);
        expect(await subWeth.balanceOf(signer.address)).toBe(0n);

        // 5. borrow USDC via the agent connector
        const borrowTx = await signer.sendTransaction(await aave.borrow({ asset: USDC, amount: borrowAmount }));
        const borrowReceipt = await borrowTx.wait();
        expect(borrowReceipt.status).toBe(1);
        const usdcAfterBorrow = await subUsdc.balanceOf(signer.address);
        expect(usdcAfterBorrow).toBeGreaterThanOrEqual(borrowAmount);

        // 6. approve + repay the full debt
        const usdcApprove = await (new Contract(USDC, ERC20_ABI, signer)).approve(pool.target, MaxUint256);
        expect((await usdcApprove.wait()).status).toBe(1);
        const repayTx = await signer.sendTransaction(await aave.repay({ asset: USDC, amount: MaxUint256 }));
        const repayReceipt = await repayTx.wait();
        expect(repayReceipt.status).toBe(1);
        const usdcReserve = await pool.getReserveData(USDC);
        const debtToken = new Contract(usdcReserve.variableDebtTokenAddress, ERC20_ABI, provider);
        expect(await debtToken.balanceOf(signer.address)).toBe(0n);
        expect(await subUsdc.balanceOf(signer.address)).toBeLessThan(borrowAmount); // only dust interest stays

        // 7. withdraw the WETH supply
        const withdrawTx = await signer.sendTransaction(await aave.withdraw({ asset: WETH, amount: wrapAmount, to: signer.address }));
        const withdrawReceipt = await withdrawTx.wait();
        expect(withdrawReceipt.status).toBe(1);
        expect(await subWeth.balanceOf(signer.address)).toBeGreaterThanOrEqual(wrapAmount - 10n); // dust tolerance

        // 8. unwrap WETH → ETH
        const unwrapTx = await subWeth.withdraw(wrapAmount);
        const unwrapReceipt = await unwrapTx.wait();
        expect(unwrapReceipt.status).toBe(1);

        // 9. final on-chain state: only gas was spent
        const ethAfter = await provider.getBalance(signer.address);
        const wethAfter = await subWeth.balanceOf(signer.address);
        const usdcFinal = await subUsdc.balanceOf(signer.address);
        expect(ethAfter).toBeGreaterThan(ethBefore - parseEther('0.0015'));
        expect(ethAfter).toBeLessThan(ethBefore);
        expect(wethAfter).toBe(0n);
        expect(usdcFinal).toBeLessThan(100n); // USDC dust only

        console.log(`[aave] lifecycle complete: supplied ${formatUnits(wrapAmount, 18)} WETH, borrowed/repaid ${formatUnits(borrowAmount, 6)} USDC, gas ≈ ${formatUnits(ethBefore - ethAfter, 18)} ETH`);
    }, 300000);
});
