// backend/execution/connectors/protocolConfig.js
// On-chain protocol addresses + minimal ABI fragments for the connectors.
//
// IMPORTANT: Aave V4 is not yet publicly deployed in the protocol's stable
// interface, so the Aave connector targets the battle-tested Aave V3 Pool
// contract interface (identical supply/borrow/repay/withdraw signatures). The
// strategy naming in the decision engine ("Aave V4 E-Mode") is preserved; when
// V4 pool addresses are released they slot in below without code changes.

export const CHAIN_IDS = {
    ethereum: 1,
    sepolia: 11155111,
    arbitrum: 42161,
    base: 8453,
};

// Aave convention for the native asset (ETH)
export const NATIVE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const TOKENS = {
    usdc: {
        1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        // Sepolia: market redeployed — USDC reserve token address verified
        // via getReservesList() on the live pool (2026-08).
        11155111: '0xda9d4f9b69ac6C22e444eD9aF0CfC043b7a7f53f',
    },
    weth: {
        1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        // Sepolia: WETH reserve token used by the current Aave V3 market
        // (verified via getReservesList() 2026-08).
        11155111: '0xD0dF82dE051244f04BfF3A8bB1f62E1cD39eED92',
    },
    sUSDe: {
        1: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    },
    usde: {
        1: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
    },
};

export const PROTOCOLS = {
    morphoBlue: {
        name: 'Morpho Blue',
        // Note: Morpho Blue is not deployed on Sepolia (verified via eth_getCode
        // on 2026-08). The connector refuses to run on chains without an entry.
        markets: {
            1: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
        },
    },
    aavePool: {
        name: 'Aave Pool (V3 interface)',
        markets: {
            1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
            // Sepolia: authoritative address from PoolAddressesProvider.getPool()
            // (0x0496275d34753A48320CA58103d5220d394FF77F). The Sepolia market
            // has ACTIVE reserves (DAI/LINK/USDC/WBTC/WETH/USDT/AAVE/EURS —
            // verified via getReservesList 2026-08), so supply/borrow can be
            // exercised on-chain.
            11155111: '0xE7EC1B0015eb2ADEedb1B7f9F1Ce82F9DAD6dF08',
        },
    },
    sUSDe: {
        name: 'StakedUSDe (Ethena)',
        markets: TOKENS.sUSDe,
    },
    // Safe (Gnosis) — canonical deterministic deployments, present on all
    // EVM chains incl. Sepolia (verified via eth_getCode 2026-08).
    safe: {
        name: 'Safe (Gnosis)',
        factoryV130: {
            1: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
            11155111: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
        },
        singletonV130: {
            1: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
            11155111: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        },
    },
    pendleRouter: {
        name: 'Pendle Router',
        markets: {
            1: '0x888888888889758F76e7103c6CbF23ABbF58F946',
        },
    },
};

export const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
];

export const MORPHO_ABI = [
    'function supply(address loanToken, address collateralToken, uint256 loanAmount, uint256 collateralAmount, address onBehalf, bytes data)',
    'function borrow(address loanToken, address collateralToken, uint256 assets, uint256 shares, address onBehalf, address receiver)',
    'function repay(address loanToken, address collateralToken, uint256 assets, uint256 shares, address onBehalf, bytes data)',
    'function withdraw(address loanToken, address collateralToken, uint256 assets, uint256 shares, address onBehalf, address receiver)',
    'function flashLoan(address token, uint256 assets, bytes data)',
];

export const AAVE_POOL_ABI = [
    'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
    'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
    'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)',
    'function withdraw(address asset, uint256 amount, address to)',
];

export const SUSDE_ABI = [
    ...ERC20_ABI,
    'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
    'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
    'function cooldownAssets(uint256 assets, address owner) returns (uint256)',
];
