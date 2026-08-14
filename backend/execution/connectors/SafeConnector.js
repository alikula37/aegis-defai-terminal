// backend/execution/connectors/SafeConnector.js
// Non-custodial custody via Safe (Gnosis) smart wallets (Faz 2.6).
// Implements:
//   - Safe proxy deployment (SafeProxyFactory.createProxyWithNonce)
//   - read-only Safe state (owners, threshold, nonce)
//   - Safe transaction hash computation + raw EOA signature + execTransaction
//
// Safe v1.3.0 details (verified against the deployed source):
//   - Domain: EIP712Domain(uint256 chainId,address verifyingContract) — NO name/version
//   - EOA owners sign the raw SafeTx hash (no eth_sign prefix); Safe recovers
//     via ecrecover(dataHash, v, r, s) in the v<=30 branch.

import { Contract, ZeroAddress, concat, getAddress, getBytes, keccak256, AbiCoder } from 'ethers';
import { PROTOCOLS } from './protocolConfig.js';

const abi = AbiCoder.defaultAbiCoder();

// keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")
const DOMAIN_SEPARATOR_TYPEHASH = '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218';
// keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")
const SAFE_TX_TYPEHASH = '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8';

const SAFE_PROXY_FACTORY_ABI = [
    'function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
    'event ProxyCreation(address proxy, address singleton)',
];

const SAFE_ABI = [
    'function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)',
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function nonce() view returns (uint256)',
    'function isOwner(address owner) view returns (bool)',
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)',
];

/**
 * Pure Safe v1.3.0 transaction hash (matches on-chain getTransactionHash).
 */
export function computeSafeTxHash({
    chainId,
    safeAddress,
    to,
    value,
    data = '0x',
    operation = 0,
    safeTxGas = 0,
    baseGas = 0,
    gasPrice = 0n,
    gasToken = ZeroAddress,
    refundReceiver = ZeroAddress,
    nonce,
}) {
    const domainSeparator = keccak256(abi.encode(
        ['bytes32', 'uint256', 'address'],
        [DOMAIN_SEPARATOR_TYPEHASH, chainId, getAddress(safeAddress)],
    ));
    const safeTxHash = keccak256(abi.encode(
        ['bytes32', 'address', 'uint256', 'bytes32', 'uint8', 'uint256', 'uint256', 'uint256', 'address', 'address', 'uint256'],
        [SAFE_TX_TYPEHASH, getAddress(to), value, keccak256(data), operation, safeTxGas, baseGas, gasPrice, getAddress(gasToken), getAddress(refundReceiver), nonce],
    ));
    return keccak256(concat(['0x1901', domainSeparator, safeTxHash]));
}

export class SafeConnector {
    constructor({ provider, signer, chainId }) {
        if (!provider) throw new Error('SafeConnector requires a provider.');
        this.provider = provider;
        this.signer = signer || provider;
        this.chainId = chainId || 1;
        const cfg = PROTOCOLS.safe;
        this.factoryAddress = cfg.factoryV130[this.chainId];
        this.singletonAddress = cfg.singletonV130[this.chainId];
        if (!this.factoryAddress || !this.singletonAddress) {
            throw new Error(`Safe not configured for chainId ${this.chainId}`);
        }
        this.factory = new Contract(this.factoryAddress, SAFE_PROXY_FACTORY_ABI, this.signer);
    }

    safeAt(address) {
        return new Contract(getAddress(address), SAFE_ABI, this.signer);
    }

    async buildDeployTx({ owners, threshold = 1, saltNonce = 1 }) {
        const singleton = new Contract(this.singletonAddress, SAFE_ABI, this.signer);
        const initializer = singleton.interface.encodeFunctionData('setup', [
            owners.map(o => getAddress(o)),
            threshold,
            ZeroAddress,
            '0x',
            ZeroAddress,
            ZeroAddress,
            0,
            ZeroAddress,
        ]);
        return this.factory.createProxyWithNonce.populateTransaction(
            this.singletonAddress,
            initializer,
            saltNonce,
        );
    }

    async readSafe(safeAddress) {
        const safe = this.safeAt(safeAddress);
        const [owners, threshold, nonce] = await Promise.all([
            safe.getOwners(),
            safe.getThreshold(),
            safe.nonce(),
        ]);
        return { owners, threshold, nonce };
    }

    /**
     * Raw EIP-712 EOA signature over the SafeTx hash, packed as Safe's 65-byte
     * {r}{s}{v} format (v = 27/28). Safe recovers with ecrecover(dataHash, v, r, s).
     */
    async signSafeTx({ safeAddress, to, value, data = '0x', operation = 0, gasPrice = 0n }) {
        const safe = this.safeAt(safeAddress);
        const nonce = await safe.nonce();
        const dataHash = computeSafeTxHash({
            chainId: this.chainId,
            safeAddress,
            to,
            value,
            data,
            operation,
            gasPrice,
            nonce,
        });
        const rawSig = this.signer.signingKey.sign(getBytes(dataHash));
        const v = rawSig.yParity + 27;
        return {
            signature: concat([rawSig.r, rawSig.s, Uint8Array.from([v])]),
            dataHash,
            nonce,
        };
    }

    async buildExecTransaction({ safeAddress, to, value, data = '0x', operation = 0, safeTxGas = 0, signatures }) {
        const safe = this.safeAt(safeAddress);
        return safe.execTransaction.populateTransaction(
            to,
            value,
            data,
            operation,
            safeTxGas,
            0, // baseGas
            0, // gasPrice
            ZeroAddress,
            ZeroAddress,
            signatures,
        );
    }
}
