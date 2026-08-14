// F2-7: Sepolia on-chain integration tests (read-only).
// These validate the execution layer against the REAL Sepolia testnet:
// protocol addresses, ABI selectors, ERC-20 reads and connector request
// building. No transactions are sent — everything is eth_call / populate.
//
// Skipped automatically when EVM_PROVIDER_URL is not configured.
import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { JsonRpcProvider, Wallet, Contract, id, getAddress } from 'ethers';
import { AavePoolConnector } from '../../execution/connectors/AavePoolConnector.js';
import { OnchainExecution } from '../../execution/OnchainExecution.js';
import { PROTOCOLS, TOKENS, NATIVE_ETH, ERC20_ABI } from '../../execution/connectors/protocolConfig.js';

dotenv.config();

const SEPOLIA_CHAIN_ID = 11155111;
const RPC = process.env.EVM_PROVIDER_URL;

// Aave V3 Sepolia PoolAddressesProvider (source of truth for the Pool address)
const SEPOLIA_ADDRESSES_PROVIDER = '0x0496275d34753A48320CA58103d5220d394FF77F';
const PROVIDER_ABI = ['function getPool() view returns (address)'];

const suite = RPC ? describe : describe.skip;

suite('Sepolia on-chain integration (read-only)', () => {
    let provider;
    let wallet;
    let aavePool;
    let usdc;

    beforeAll(() => {
        provider = new JsonRpcProvider(RPC, SEPOLIA_CHAIN_ID);
        wallet = Wallet.createRandom().connect(provider);
        aavePool = PROTOCOLS.aavePool.markets[SEPOLIA_CHAIN_ID];
        usdc = TOKENS.usdc[SEPOLIA_CHAIN_ID];
    });

    it('connects to the Sepolia network', async () => {
        const net = await provider.getNetwork();
        expect(Number(net.chainId)).toBe(SEPOLIA_CHAIN_ID);
        const block = await provider.getBlockNumber();
        expect(block).toBeGreaterThan(0);
    });

    it('the configured Aave Pool is the authoritative deployment (getPool)', async () => {
        const addressesProvider = new Contract(SEPOLIA_ADDRESSES_PROVIDER, PROVIDER_ABI, provider);
        const actualPool = await addressesProvider.getPool();
        expect(actualPool.toLowerCase()).toBe(aavePool.toLowerCase());
    });

    it('Aave Pool and USDC contracts exist on-chain (protocolConfig correct)', async () => {
        for (const addr of [aavePool, usdc]) {
            const code = await provider.getCode(addr);
            expect(code).not.toBe('0x');
        }
    });

    it('Aave Pool responds to getReserveData for native ETH (ABI selector valid)', async () => {
        const selector = id('getReserveData(address)').slice(0, 10);
        const data = selector + getAddress(NATIVE_ETH).slice(2).toLowerCase().padStart(64, '0');
        const result = await provider.call({ to: aavePool, data });
        expect(result).not.toBe('0x');
        expect(result.length).toBeGreaterThan(2);
    });

    it('USDC ERC-20 balanceOf works (ERC20 ABI valid)', async () => {
        const usdcContract = new Contract(usdc, ERC20_ABI, provider);
        const balance = await usdcContract.balanceOf(wallet.address);
        expect(typeof balance).toBe('bigint');
    });

    it('Aave connector builds valid supply/borrow/repay/withdraw requests', async () => {
        const conn = new AavePoolConnector({ provider, signer: wallet, chainId: SEPOLIA_CHAIN_ID });
        const amount = 1_000_000n; // 1 USDC (6 decimals)

        const supply = await conn.supply({ asset: usdc, amount });
        expect(supply.to.toLowerCase()).toBe(aavePool.toLowerCase());
        expect(supply.data.length).toBeGreaterThan(10);

        const borrow = await conn.borrow({ asset: usdc, amount });
        expect(borrow.to.toLowerCase()).toBe(aavePool.toLowerCase());
        expect(borrow.data.length).toBeGreaterThan(10);

        const repay = await conn.repay({ asset: usdc, amount });
        expect(repay.data.length).toBeGreaterThan(10);

        const withdraw = await conn.withdraw({ asset: usdc, amount });
        expect(withdraw.data.length).toBeGreaterThan(10);
    });

    it('OnchainExecution refuses Morpho plans on Sepolia without crashing', async () => {
        const log = [];
        const exec = new OnchainExecution({
            provider,
            signer: wallet,
            chainId: SEPOLIA_CHAIN_ID,
            log: (type, m) => log.push(`${type}: ${m}`),
            broadcast: () => { },
            config: { maxGasLimitUsd: 100, slippageBps: 50 },
        });
        const marketData = { portfolio: { tvl: 10000, currentLtv: 0.8 }, gasPrice: 15, ethPrice: 2500, leverage: 5 };
        await exec.execute({ decision: 'unwind' }, marketData, {});
        expect(log.some(m => /not available/.test(m))).toBe(true);
        expect(log.some(m => /morpho/i.test(m))).toBe(true);
    });

    it('OnchainExecution builds an Aave-only borrow-migration plan on Sepolia', async () => {
        const log = [];
        const exec = new OnchainExecution({
            provider,
            signer: wallet,
            chainId: SEPOLIA_CHAIN_ID,
            log: (type, m) => log.push(`${type}: ${m}`),
            broadcast: () => { },
            config: { maxGasLimitUsd: 100, slippageBps: 50 },
        });
        const marketData = { portfolio: { tvl: 10000, currentLtv: 0.8 }, gasPrice: 15, ethPrice: 2500, leverage: 5 };

        // migrate_borrow → morpho.repay is skipped (Morpho absent on Sepolia),
        // leaving an Aave-only plan (approve + supply + borrow). The PT
        // collateral must be resolvable for the plan to build (fail-closed).
        const plan = await exec._buildPlan({ decision: 'migrate_borrow' }, {
            ...marketData,
            strategies: [{ id: 'pendle-pt-susde', tokenAddress: '0x000000000000000000000000000000000000dEaD' }],
        });
        expect(plan.length).toBe(3);
        expect(plan.map(p => p.name)).toEqual(['aave.approve-usdc', 'aave.supply', 'aave.borrow']);
        expect(plan.filter(p => p.name !== 'aave.approve-usdc').every(p => p.tx.to.toLowerCase() === aavePool.toLowerCase())).toBe(true);

        // real on-chain gas price is readable (validates RPC + provider wiring)
        const feeData = await provider.getFeeData();
        expect(Number(feeData.gasPrice)).toBeGreaterThan(0);
    });
});
