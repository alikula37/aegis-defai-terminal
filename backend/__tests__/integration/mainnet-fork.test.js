// Aegis mainnet readiness — fork verification (Fork Doğrulama).
//
// Runs the EXACT production paths (connectors, Safe deploy, Aave V3 lifecycle,
// ERC-20 ops) against a local Anvil fork of Ethereum mainnet. Real mainnet
// state, real rates, zero real money: every transaction is mined only on the
// fork and discarded with it.
//
// Setup (Linux/WSL):
//   anvil --fork-url <mainnet-rpc> --port 8545 --chain-id 1 &
//   (wallet is funded via anvil_setBalance + impersonated whale transfers —
//    see docs/MAINNET_FORK.md for the funding recipe)
//
// Env: MAINNET_FORK_URL (default http://127.0.0.1:8545),
//      MAINNET_FORK_PRIVATE_KEY (defaults to the fork-only dev wallet)
import { describe, it, expect, afterAll } from 'vitest';
import dotenv from 'dotenv';
import { JsonRpcProvider, Wallet, Contract, parseEther, parseUnits, formatUnits, MaxUint256, getAddress } from 'ethers';
import { AavePoolConnector } from '../../execution/connectors/AavePoolConnector.js';
import { SafeConnector } from '../../execution/connectors/SafeConnector.js';
import { PROTOCOLS, TOKENS, ERC20_ABI } from '../../execution/connectors/protocolConfig.js';

dotenv.config();

const CHAIN_ID = 1;
const RPC_URL = process.env.MAINNET_FORK_URL || 'http://127.0.0.1:8545';
// Fork-only signer. The key has NO mainnet funds and only exists on the local
// fork; it is never loaded unless the fork test is run. Loaded from env so the
// key never lives in source. See docs/MAINNET_FORK.md for the funding recipe.
const PRIVATE_KEY = process.env.MAINNET_FORK_PRIVATE_KEY;

// Mainnet PoolAddressesProvider — source of truth for the Pool address
const MAINNET_ADDRESSES_PROVIDER = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';
const PROVIDER_ABI = ['function getPool() view returns (address)'];

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

let forkUp = false;
let reservesActive = false;
let USDC = null;
let WETH = null;
let provider;
let wallet;
let pool;
let weth;
let usdc;

async function probeReserves() {
    const list = (await pool.getReservesList()).map(getAddress);
    for (const asset of list) {
        const token = new Contract(asset, ERC20_SYMBOL_ABI, provider);
        const symbol = await token.symbol().catch(() => null);
        if (symbol === 'USDC' && !USDC) USDC = asset;
        if (symbol === 'WETH' && !WETH) WETH = asset;
    }
    reservesActive = Boolean(USDC && WETH);
    return list;
}

try {
    if (!PRIVATE_KEY) throw new Error('MAINNET_FORK_PRIVATE_KEY env not set — see docs/MAINNET_FORK.md');
    provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
    // ethers 6 caches block number / nonce and only refreshes them while block
    // polling is active. On anvil (automine) without any 'block' listener the
    // cache goes stale → wait() never resolves and nonces get reused. Keeping a
    // no-op block listener forces fresh polling.
    provider.on('block', () => {});
    wallet = new Wallet(PRIVATE_KEY, provider);
    await provider.getBlockNumber();
    forkUp = true;
    pool = new Contract(getAddress(PROTOCOLS.aavePool.markets[CHAIN_ID]), POOL_ABI, provider);
    const list = await probeReserves();
    if (reservesActive) {
        weth = new Contract(WETH, WETH_ABI, wallet);
        usdc = new Contract(USDC, ERC20_ABI, provider);
    }
    console.log(`[fork] mainnet fork OK: reserves probe ${list.length} active (USDC=${reservesActive ? getAddress(USDC).slice(0, 8) : 'missing'}, WETH=${reservesActive ? getAddress(WETH).slice(0, 8) : 'missing'})`);
} catch (err) {
    console.log(`[fork] mainnet fork unreachable (${err.message.slice(0, 100)}). Start anvil, see docs/MAINNET_FORK.md`);
}

afterAll(() => {
    // drop the block listener so vitest can exit cleanly
    provider?.removeAllListeners('block');
});

const suite = forkUp ? describe : describe.skip;

suite('Ethereum MAINNET — fork verification (anvil)', () => {
    it('connects to a mainnet-state fork (chainId 1, live block)', async () => {
        const net = await provider.getNetwork();
        expect(Number(net.chainId)).toBe(1);
        const block = await provider.getBlockNumber();
        expect(block).toBeGreaterThan(20000000); // post-Shanghai mainnet state
    });

    it('protocolConfig Aave Pool matches the authoritative mainnet deployment', async () => {
        const addressesProvider = new Contract(MAINNET_ADDRESSES_PROVIDER, PROVIDER_ABI, provider);
        const actualPool = await addressesProvider.getPool();
        expect(actualPool.toLowerCase()).toBe(getAddress(PROTOCOLS.aavePool.markets[1]).toLowerCase());
    });

    it('mainnet Aave Pool, USDC, WETH and Morpho Blue contracts exist on the fork', async () => {
        for (const addr of [PROTOCOLS.aavePool.markets[1], TOKENS.usdc[1], TOKENS.weth[1], PROTOCOLS.morphoBlue.markets[1], PROTOCOLS.pendleRouter.markets[1], TOKENS.sUSDe[1]]) {
            const code = await provider.getCode(addr);
            expect(code).not.toBe('0x');
        }
    });

    it('mainnet reserves carry real rates (liquidity + variable borrow)', async () => {
        const usdcReserve = await pool.getReserveData(USDC);
        const wethReserve = await pool.getReserveData(WETH);
        expect(usdcReserve.currentLiquidityRate).toBeGreaterThan(0n);
        expect(usdcReserve.currentVariableBorrowRate).toBeGreaterThan(0n);
        expect(wethReserve.currentLiquidityRate).toBeGreaterThan(0n);
        console.log(`[fork] mainnet rates: USDC supply ${formatUnits(usdcReserve.currentLiquidityRate, 27).slice(0, 4)}%, borrow ${formatUnits(usdcReserve.currentVariableBorrowRate, 27).slice(0, 4)}%`);
    });

    it('fork wallet is funded (pre-flight)', async () => {
        const eth = await provider.getBalance(wallet.address);
        const usdcBal = await usdc.balanceOf(wallet.address);
        const wethBal = await weth.balanceOf(wallet.address);
        expect(eth).toBeGreaterThan(parseEther('1'));
        expect(usdcBal).toBeGreaterThan(parseUnits('10', 6));
        expect(wethBal).toBeGreaterThan(parseEther('1'));
    });

    it('full Aave V3 lifecycle on mainnet fork: supply → borrow → repay → withdraw', async () => {
        const aave = new AavePoolConnector({ provider, signer: wallet, chainId: CHAIN_ID });

        // Pre-flight: wallet must be debt-free on the fork
        const preUsdcReserve = await pool.getReserveData(USDC);
        const preDebtToken = new Contract(preUsdcReserve.variableDebtTokenAddress, ERC20_ABI, provider);
        expect(await preDebtToken.balanceOf(wallet.address)).toBe(0n);

        const wrapAmount = parseEther('0.01');
        const borrowAmount = parseUnits('5', 6);

        const ethBefore = await provider.getBalance(wallet.address);
        const wethBefore = await weth.balanceOf(wallet.address);
        const usdcBefore = await usdc.balanceOf(wallet.address);
        expect(wethBefore).toBeGreaterThan(parseEther('1'));
        expect(usdcBefore).toBeGreaterThan(parseUnits('10', 6));

        const sendAndWait = async (tx, gasLimit) => {
            const raw = await provider.send('eth_getTransactionCount', [wallet.address, 'pending']);
            const sent = await wallet.sendTransaction({ ...tx, nonce: Number(raw), gasLimit });
            const rc = await sent.wait();
            expect(rc.status).toBe(1);
            return rc;
        };

        // 1. wrap ETH → WETH
        await sendAndWait(await weth.deposit.populateTransaction({ value: wrapAmount }), 150000n);

        // 2. approve pool
        await sendAndWait(await weth.approve.populateTransaction(pool.target, MaxUint256), 60000n);

        // 3. supply via the agent connector
        await sendAndWait(await aave.supply({ asset: WETH, amount: wrapAmount }), 400000n);

        // 4. aToken balance arrived; wrapped WETH fully supplied (balance back
        // to its pre-wrap level — the fork wallet may carry WETH from earlier
        // runs, so we compare against the captured baseline instead of 0)
        const wethReserve = await pool.getReserveData(WETH);
        const aToken = new Contract(wethReserve.aTokenAddress, ERC20_ABI, provider);
        expect(await aToken.balanceOf(wallet.address)).toBeGreaterThan(0n);
        expect(await weth.balanceOf(wallet.address)).toBe(wethBefore);

        // 5. borrow USDC via the agent connector
        await sendAndWait(await aave.borrow({ asset: USDC, amount: borrowAmount }), 500000n);
        expect(await usdc.balanceOf(wallet.address)).toBeGreaterThanOrEqual(borrowAmount);

        // 6. repay full debt (MaxUint256 pulls the current debt — wallet must be solvent)
        const usdcContract = new Contract(USDC, ERC20_ABI, wallet);
        await sendAndWait(await usdcContract.approve.populateTransaction(pool.target, MaxUint256), 60000n);
        await sendAndWait(await aave.repay({ asset: USDC, amount: MaxUint256 }), 400000n);

        const usdcReserve = await pool.getReserveData(USDC);
        const debtToken = new Contract(usdcReserve.variableDebtTokenAddress, ERC20_ABI, provider);
        expect(await debtToken.balanceOf(wallet.address)).toBe(0n);

        // 7. withdraw supply
        await sendAndWait(await aave.withdraw({ asset: WETH, amount: wrapAmount, to: wallet.address }), 400000n);
        expect(await weth.balanceOf(wallet.address)).toBeGreaterThanOrEqual(wrapAmount - 10n);

        // 8. unwrap back to ETH
        await sendAndWait(await weth.withdraw.populateTransaction(wrapAmount), 150000n);

        // 9. final state: only gas spent, WETH back to baseline, USDC back to
        // baseline minus a few units of interest dust (borrow+repay is net-zero)
        const ethAfter = await provider.getBalance(wallet.address);
        const wethAfter = await weth.balanceOf(wallet.address);
        const usdcFinal = await usdc.balanceOf(wallet.address);
        expect(ethAfter).toBeGreaterThan(ethBefore - parseEther('0.002'));
        expect(ethAfter).toBeLessThan(ethBefore);
        expect(wethAfter).toBe(wethBefore);
        expect(usdcFinal).toBeLessThan(usdcBefore);
        expect(usdcFinal).toBeGreaterThan(usdcBefore - 100n);

        console.log(`[fork] Aave lifecycle complete on MAINNET fork: supplied ${formatUnits(wrapAmount, 18)} WETH, borrowed/repaid ${formatUnits(borrowAmount, 6)} USDC, gas ≈ ${formatUnits(ethBefore - ethAfter, 18)} ETH`);
    }, 300000);

    it('deploys a Safe proxy on the mainnet fork and executes a signed transfer', async () => {
        const safe = new SafeConnector({ provider, signer: wallet, chainId: CHAIN_ID });
        const factory = new Contract(
            PROTOCOLS.safe.factoryV130[CHAIN_ID],
            ['event ProxyCreation(address proxy, address singleton)'],
            provider,
        );

        const saltNonce = Date.now();
        const deployTx = await safe.buildDeployTx({ owners: [wallet.address], threshold: 1, saltNonce });

        // Raw pending nonce per send — ethers' cached nonce can lag right after
        // a mined tx on anvil (see the lifecycle test note).
        const nextNonce = async () => Number(await provider.send('eth_getTransactionCount', [wallet.address, 'pending']));
        const sent = await wallet.sendTransaction({ ...deployTx, nonce: await nextNonce(), gasLimit: 400000n });
        const receipt = await sent.wait();
        expect(receipt.status).toBe(1);

        const proxyLog = receipt.logs.map(l => {
            try { return factory.interface.parseLog(l); } catch { return null; }
        }).find(p => p && p.name === 'ProxyCreation');
        expect(proxyLog).toBeTruthy();
        const safeAddress = proxyLog.args.proxy;

        const state = await safe.readSafe(safeAddress);
        expect(state.owners.map(o => o.toLowerCase())).toContain(wallet.address.toLowerCase());
        expect(Number(state.threshold)).toBe(1);

        // Fund the Safe, then execute a signed transfer out of it
        const fundAmount = parseEther('0.05');
        await (await wallet.sendTransaction({ to: safeAddress, value: fundAmount, nonce: await nextNonce() })).wait();
        expect(await provider.getBalance(safeAddress)).toBe(fundAmount);

        const recipient = Wallet.createRandom().address;
        const sendAmount = parseEther('0.02');
        const { signature } = await safe.signSafeTx({ safeAddress, to: recipient, value: sendAmount });
        const execTx = await safe.buildExecTransaction({
            safeAddress, to: recipient, value: sendAmount, signatures: signature,
        });
        const execReceipt = await (await wallet.sendTransaction({ ...execTx, nonce: await nextNonce(), gasLimit: 500000n })).wait();
        expect(execReceipt.status).toBe(1);
        expect(await provider.getBalance(recipient)).toBe(sendAmount);

        console.log(`[fork] Safe ${safeAddress.slice(0, 10)}… deployed + executed ${formatUnits(sendAmount, 18)} ETH transfer on MAINNET fork`);
    }, 180000);
});
