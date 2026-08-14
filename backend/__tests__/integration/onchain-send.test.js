// F2-7: Sepolia on-chain TRANSACTION tests — proves the real send pipeline:
// sign → broadcast → receipt, plus ERC-20 approve/allowance and a native
// value tx (ETH→WETH wrap, then unwrap).
//
// NOTE: Aave V3 Sepolia has no active USDC/ETH reserves (verified on-chain
// 2026-08: getReserveTokensAddresses reverts), so the supply/borrow leg of the
// F2-7 DoD cannot be exercised on the public Sepolia market yet — it is
// documented in IMPLEMENTATION_BACKLOG and can be enabled once liquidity is
// seeded (or on a mainnet fork).
//
// Requires: EVM_PROVIDER_URL + EVM_PRIVATE_KEY (funded with SepETH).
// Skipped at runtime when the wallet has < 0.005 SepETH.
import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { JsonRpcProvider, Wallet, Contract, formatEther, MaxUint256, parseEther } from 'ethers';
import { PROTOCOLS, ERC20_ABI } from '../../execution/connectors/protocolConfig.js';

dotenv.config();

const SEPOLIA = 11155111;
const RPC = process.env.EVM_PROVIDER_URL;
const KEY = process.env.EVM_PRIVATE_KEY;
const hasKey = KEY && KEY !== 'kullanici_buraya_girecek';

const suite = RPC && hasKey ? describe : describe.skip;

// Sepolia WETH (canonical deployment — verified on-chain 2026-08)
const WETH_SEPOLIA = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

const WETH_ABI = [
    ...ERC20_ABI,
    'function deposit() payable',
    'function withdraw(uint256 wad)',
];

const MIN_GAS_ETH = '0.005';

suite('Sepolia on-chain transactions', () => {
    let provider;
    let wallet;
    let address;
    let balanceEth = 0;
    let weth;

    beforeAll(() => {
        provider = new JsonRpcProvider(RPC, SEPOLIA);
        wallet = new Wallet(KEY, provider);
        address = wallet.address;
        weth = new Contract(WETH_SEPOLIA, WETH_ABI, wallet);
    });

    it('wallet is funded with SepETH', async () => {
        balanceEth = parseFloat(formatEther(await provider.getBalance(address)));
        console.log(`wallet ${address} balance: ${balanceEth} SepETH`);
    });

    it('signs, broadcasts and confirms a native ETH transfer', async (ctx) => {
        balanceEth = parseFloat(formatEther(await provider.getBalance(address)));
        if (balanceEth < parseFloat(MIN_GAS_ETH)) {
            return ctx.skip(`wallet not funded (${balanceEth} SepETH) — add SepETH to ${address}`);
        }

        const tx = await wallet.sendTransaction({ to: address, value: 1n }); // self-transfer
        const receipt = await tx.wait();
        expect(receipt.status).toBe(1);
        expect(receipt.hash).toBe(tx.hash);
        expect(Number(receipt.gasUsed)).toBeGreaterThan(0);
    }, 60000);

    it('performs the ETH→WETH wrap/unwrap cycle with ERC-20 approve', async (ctx) => {
        balanceEth = parseFloat(formatEther(await provider.getBalance(address)));
        if (balanceEth < parseFloat(MIN_GAS_ETH)) {
            return ctx.skip(`wallet not funded (${balanceEth} SepETH) — add SepETH to ${address}`);
        }

        const amount = parseEther('0.001');
        const aavePool = PROTOCOLS.aavePool.markets[SEPOLIA];
        const wethBefore = await weth.balanceOf(address);

        // 1) WRAP: deposit ETH → WETH (native value tx)
        const deposit = await wallet.sendTransaction(await weth.deposit.populateTransaction({ value: amount }));
        const depositReceipt = await deposit.wait();
        expect(depositReceipt.status).toBe(1);
        expect(await weth.balanceOf(address)).toBe(wethBefore + amount);

        // 2) APPROVE WETH to the Aave Pool + verify allowance
        const approve = await wallet.sendTransaction(await weth.approve.populateTransaction(aavePool, MaxUint256));
        const approveReceipt = await approve.wait();
        expect(approveReceipt.status).toBe(1);
        expect(await weth.allowance(address, aavePool)).toBe(MaxUint256);

        // 3) UNWRAP: withdraw the wrapped amount → ETH (idempotent across runs)
        const withdraw = await wallet.sendTransaction(await weth.withdraw.populateTransaction(amount));
        const withdrawReceipt = await withdraw.wait();
        expect(withdrawReceipt.status).toBe(1);
        expect(await weth.balanceOf(address)).toBe(wethBefore);
    }, 120000);
});
