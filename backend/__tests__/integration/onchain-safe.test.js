// F2-6: Safe (Gnosis) non-custodial wallet on Sepolia — real lifecycle:
// deploy a Safe proxy → read owners/threshold → fund it → execute a signed
// transfer via execTransaction (EIP-712 owner signature).
// Requires: EVM_PROVIDER_URL + EVM_PRIVATE_KEY (funded). Skipped when unfunded.
import { describe, it, expect, beforeAll } from 'vitest';
import dotenv from 'dotenv';
import { JsonRpcProvider, Wallet, Contract, formatEther, parseEther } from 'ethers';
import { SafeConnector } from '../../execution/connectors/SafeConnector.js';
import { PROTOCOLS } from '../../execution/connectors/protocolConfig.js';

dotenv.config();

const SEPOLIA = 11155111;
const RPC = process.env.EVM_PROVIDER_URL;
const KEY = process.env.EVM_PRIVATE_KEY;
const hasKey = KEY && KEY !== 'kullanici_buraya_girecek';

const suite = RPC && hasKey ? describe : describe.skip;

suite('Safe (Gnosis) on Sepolia', () => {
    let provider;
    let wallet;
    let address;
    let safe;
    let factory;

    beforeAll(() => {
        provider = new JsonRpcProvider(RPC, SEPOLIA);
        wallet = new Wallet(KEY, provider);
        address = wallet.address;
        safe = new SafeConnector({ provider, signer: wallet, chainId: SEPOLIA });
        factory = new Contract(
            PROTOCOLS.safe.factoryV130[SEPOLIA],
            ['event ProxyCreation(address proxy, address singleton)'],
            provider,
        );
    });

    it('deploys a Safe proxy and reads back owners/threshold', async (ctx) => {
        const balance = parseFloat(formatEther(await provider.getBalance(address)));
        if (balance < 0.01) return ctx.skip(`wallet not funded (${balance} SepETH)`);

        const saltNonce = Date.now();
        const deployTx = await safe.buildDeployTx({ owners: [address], threshold: 1, saltNonce });
        const sent = await wallet.sendTransaction({ ...deployTx, gasLimit: 400000n });
        const receipt = await sent.wait();
        expect(receipt.status).toBe(1);

        const proxyLog = receipt.logs.map(l => {
            try { return factory.interface.parseLog(l); } catch { return null; }
        }).find(p => p && p.name === 'ProxyCreation');
        expect(proxyLog).toBeTruthy();
        const safeAddress = proxyLog.args.proxy;
        expect(safeAddress.toLowerCase() !== address.toLowerCase()).toBe(true);

        const state = await safe.readSafe(safeAddress);
        expect(state.owners.map(o => o.toLowerCase())).toContain(address.toLowerCase());
        expect(Number(state.threshold)).toBe(1);

        // persist for the next test
        safe.lastSafeAddress = safeAddress;
    }, 180000);

    it('executes a signed transfer from the Safe via execTransaction', async (ctx) => {
        const safeAddress = safe.lastSafeAddress;
        if (!safeAddress) return ctx.skip('no Safe deployed in previous step');

        // fund the Safe
        const fundAmount = parseEther('0.001');
        await (await wallet.sendTransaction({ to: safeAddress, value: fundAmount })).wait();

        const transferAmount = parseEther('0.0005');
        const nonceBefore = (await safe.readSafe(safeAddress)).nonce;

        // build + sign the SafeTx (raw EIP-712 hash) and execute
        const { signature } = await safe.signSafeTx({ safeAddress, to: address, value: transferAmount });
        const execTx = await safe.buildExecTransaction({
            safeAddress, to: address, value: transferAmount, signatures: signature,
        });
        const sent = await wallet.sendTransaction({ ...execTx, gasLimit: 500000n });
        const receipt = await sent.wait();
        expect(receipt.status).toBe(1);

        const nonceAfter = (await safe.readSafe(safeAddress)).nonce;
        const safeBalance = await provider.getBalance(safeAddress);

        // Safe sent exactly the requested amount and advanced its nonce
        expect(fundAmount - safeBalance).toBe(transferAmount);
        expect(nonceAfter).toBe(nonceBefore + 1n);
    }, 180000);
});
