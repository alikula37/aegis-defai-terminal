export default {
    networks: {
        ethereum: {
            name: 'Ethereum Mainnet',
            chainId: 1,
            rpcEnvKey: 'EVM_PROVIDER_URL'
        },
        arbitrum: {
            name: 'Arbitrum One',
            chainId: 42161,
            rpcEnvKey: 'ARBITRUM_RPC_URL'
        },
        base: {
            name: 'Base',
            chainId: 8453,
            rpcEnvKey: 'BASE_RPC_URL'
        }
    },
    llm: {
        defaultModel: 'meta-llama/llama-3.1-70b-instruct',
        fallbackModel: 'openai/gpt-4o-mini',
        maxTokens: 1500,
        temperature: 0.2,
        // Faz 2.8 — LLM maliyet kontrolü
        budget: {
            // Ajan döngüsü başına azami LLM çağrısı (0 = LLM hiç kullanılmaz)
            maxCallsPerCycle: 1,
            // Faz 3 (B3-7) — haftalık azami LLM çağrısı (0 = sınırsız; bellek içi pencere)
            weeklyMaxCalls: 50
        },
        // Faz 3 — tool-calling ajan (B3-3)
        tools: {
            // LLM karar vermeden önce salt-okunur tool'ları kullanabilsin mi
            enabled: true,
            // Tek karar başına azami LLM turu (sonsuz döngü koruması)
            maxRounds: 3,
            // Döngü başına azami tool çağrısı (bütçe)
            maxToolCalls: 6,
            // Tool çağrısını desteklemeyen modeller (yönetim dışlama listesi)
            excludedModels: []
        }
    },
    agent: {
        cycleIntervalMs: 15000,
        maxLeverage: 10,
        // Faz 2.5 (B2.5-7) — bir döngü bu süreyi aşarsa stuck-detection uyarısı
        // yayınlanır (0 = kapalı).
        cycleWatchdogMs: 60000,
        // Faz 2.5 (B2.5-8) — birincil LLM çağrısı ağ hatası verirse yedek modelle
        // tek deneme yapılır (yalnızca 5xx/429/timeout için).
        llmFallbackRetry: true,
        defaultSlippage: 0.5
    },
    // Faz 2 — yürütme arka ucu seçimi.
    // 'simulation' → sahte yürütme (mevcut davranış, varsayılan).
    // 'onchain'    → ethers + protokol bağlayıcıları ile gerçek testnet/mainnet yürütme.
    //   onchain modda provider/signer ayarlanmazsa ajan yürütmeyi REDDEDER (güvenli).
    //   RPC: execution.rpcUrl veya env EVM_PROVIDER_URL. Signer: env EVM_PRIVATE_KEY (yalnızca testnet!).
    execution: {
        mode: 'simulation',
        chainId: 11155111, // Sepolia
        rpcUrl: null,      // fallback: process.env.EVM_PROVIDER_URL
        slippageBps: 50,   // 0.5% slippage toleransı
        maxGasLimitUsd: 10,// işlem planı başına azami gaz maliyeti (USD)
        gas: {
            defaultGasLimit: 100000,
        },
        // Faz 4 (A2) — Morpho Blue marketi: Morpho plan'ları (borrow/repay/unwind)
        // marketi oracle/irm/lltv üçlüsüyle tanımlar. Boş bırakılırsa Morpho
        // plan'ları fail-closed reddedilir (zincire geçersiz market çağrısı gitmez).
        // Canlı mainnet öncesi gerçek strateji marketinin oracle/irm/lltv adresleri
        // buraya (veya env'den) girilmelidir:
        //   morphoMarket: {
        //       collateralToken: '<PT address>',
        //       oracle: '<chainlink oracle>',
        //       irm: '<morpho irm>',
        //       lltv: 860000n, // 86%
        //   }
        morphoMarket: null,
    },
    marketData: {
        // Data source used by the agent when no per-user setting is stored:
        // 'LIVE' → real oracles (default), 'SIM' → seeded scenarios
        mode: 'LIVE',
        // DefiLlama pool ids used for live rates and backtesting
        pools: {
            susde: '66985a81-9c51-46ca-9977-42b4fe7bc6df',
            pendleSusde: 'afdef3b3-8c37-5156-9c39-c2849e20f7a8',
            morphoUsdcEthereum: 'ba68527f-8ec2-4c55-827a-8f4673ae047c'
        },
        // USDC token addresses per chain (loan asset for borrow rates)
        usdcAddresses: {
            1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
        },
        fundingCoin: 'ETH',
        // Strategy parameters without a free real-time oracle source.
        // These are documented constants (Phase 2 adds on-chain connectors).
        documentedConstants: {
            ptSyrupUsdcApy: 5.0,          // Maple RWA fixed yield (4.9-5.09%)
            jitLiquidityApy: 30.0,        // Uniswap JIT baseline
            morphoPointsApy: 1.0,         // MOR point economy estimate
            enaPointsApy: 2.0,            // ENA point economy estimate
            borosFundingYieldShare: 0.15, // Boros hedge share of sUSDe yield
            corkHedgeCost: 0.15,          // Cork hedge cost in % APY
            bridgeCostUsd: 25,            // CCIP bridge fixed cost estimate ($)
            simulatedGasPriceGwei: 15     // Gas fallback when no RPC is configured
        }
    }
};
