# Mainnet Fork Doğrulama (Anvil)

Ajanı **canlı mainnet'e** taşımadan önce, tüm yürütme yolları (Aave V3, Safe,
ERC-20) gerçek mainnet durumuna karşı **yerel bir anvil fork'unda** doğrulanır.
Gerçek mainnet state'i, gerçek oranlar, **sıfır gerçek para** — her işlem yalnızca
fork'ta madencilir ve fork ile birlikte atılır.

## Neden fork?

| | Canlı Sepolia | Canlı Mainnet | Mainnet Fork |
|---|---|---|---|
| Gerçek mainnet adresleri/oranları | ❌ | ✅ | ✅ |
| Para riski | Düşük | Çok yüksek | **Sıfır** |
| Deterministik (block sabitleme) | ❌ | ❌ | ✅ |
| Whales/kitlesel fonlama | ❌ | ❌ | ✅ (impersonate) |
| Yürütme süresi | ~saniyeler | dakikalar | ~saniyeler |

## Kurulum

```bash
# Foundry (anvil/cast) kurulu değilse:
curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup
```

Fork'u başlat (public archive gerektirmeyen bir RPC; `publicnode` arşiv
istediği için çalışmaz — `eth.drpc.org` / `1rpc.io` önerilir):

```bash
setsid -f ~/.foundry/bin/anvil --fork-url https://eth.drpc.org --port 8545 --chain-id 1 --silent \
  < /dev/null > /tmp/anvil.log 2>&1

curl -s -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'   # doğrulama
```

> `--fork-block-number <N>` ile blok sabitlemek için archive RPC (Alchemy/Infura
> Archive) gerekir. Sabitlemeden de tamamen yeterli.

## Fork cüzdanını fonlama (ayrıntılı tarif)

Fork testi varsayılan olarak `0x055d7f…` private key'ini kullanır (fork'a özel,
gerçek değeri olmayan üretilmiş anahtar; adres `0x87e9b0D6E23db76088EA421D355a9936C4e2D5D4`).
Bu cüzdanın ana ağda **hiçbir bakiyesi yoktur** — fork'ta her şey aşağıdaki
komutlarla "madenlenir":

```bash
FORK=http://127.0.0.1:8545
CAST=~/.foundry/bin/cast
W=0x87e9b0D6E23db76088EA421D355a9936C4e2D5D4
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
DEP=0x00000000219ab540356cBB839Cbe05303d7705Fa          # ETH2 deposit sözleşmesi (dev ETH)
CUSDC=0x39AA39c021dfbaE8faC545936693aC917d5E7563        # Compound cUSDC (USDC whalesi)

# 1) ETH: doğrudan
$CAST rpc anvil_setBalance $W 0x56BC75E2D63100000 --rpc-url $FORK      # 100 ETH

# 2) WETH: dev ETH tutan sözleşmeyi impersonate et → deposit → transfer
$CAST rpc anvil_setBalance $DEP 0x3635C9ADC5DEA00000 --rpc-url $FORK   # 1000 ETH (gaz için)
$CAST rpc anvil_impersonateAccount $DEP --rpc-url $FORK
$CAST send $WETH "deposit()" --value 100ether --from $DEP --unlocked --rpc-url $FORK
$CAST send $WETH "transfer(address,uint256)" $W 20000000000000000000 --from $DEP --unlocked --rpc-url $FORK

# 3) USDC: cUSDC whalesini impersonate et → transfer
$CAST rpc anvil_setBalance $CUSDC 0x3635C9ADC5DEA00000 --rpc-url $FORK
$CAST rpc anvil_impersonateAccount $CUSDC --rpc-url $FORK
$CAST send $USDC "transfer(address,uint256)" $W 2000000000 --from $CUSDC --unlocked --rpc-url $FORK

# Doğrulama
$CAST balance $W --rpc-url $FORK
$CAST call $WETH "balanceOf(address)(uint256)" $W --rpc-url $FORK
$CAST call $USDC "balanceOf(address)(uint256)" $W --rpc-url $FORK
```

> `anvil_setTokenBalance` (hardhat tarzı) bu anvil sürümünde yok; whale
> impersonation + transfer güvenilir yoldur. USDC için cUSDC (`~$3M`) veya
> Circle adresi kullanılabilir — Binance/Coinbase adresleri fork'ta boş olabilir,
> önce `balanceOf` ile kontrol edin.

## Testleri çalıştırma

```bash
npm run test:fork    # vitest.integration.config.js + mainnet-fork.test.js
```

`backend/__tests__/integration/mainnet-fork.test.js` (7 test):

1. **Fork bağlantısı** — chainId 1, blok > 20M (Shapella sonrası mainnet state)
2. **Aave Pool otoritesi** — `PoolAddressesProvider.getPool()` == protocolConfig
3. **Kontrat varlığı** — Aave Pool, USDC, WETH, Morpho Blue, Pendle Router, sUSDe
4. **Gerçek oranlar** — USDC/WETH liquidity + borrow rate > 0
5. **Cüzdan fonlaması** — pre-flight (ETH/WETH/USDC)
6. **Aave V3 tam yaşam döngüsü** — wrap → approve → supply → borrow → repay →
   withdraw → unwrap (ana ağ protokolüne karşı, gerçek oranlarla)
7. **Safe deploy + imzalı transfer** — mainnet Safe factory + EIP-712 imza

## Ajanı fork'a yönlendirme

Ajan onchain modda fork'a (veya gerçek mainnet'e) şu env'lerle bağlanır:

```bash
EXECUTION_MODE=onchain \
EVM_CHAIN_ID=1 \
EVM_PROVIDER_URL=http://127.0.0.1:8545 \
EVM_PRIVATE_KEY=0x055d7f… \
npm start
```

`EVM_CHAIN_ID` (Faz: fork) olmadan ajan yalnızca Sepolia'yı hedefler;
fork RPC'sine Sepolia chainId'si ile bağlanırsa bağlantı reddedilir.

## Bilinen bulgular (bu çalışma sırasında düzeltildi)

- **Pendle Router mainnet adresinin EIP-55 checksum'ı hatalıydı** (`…F58f946`
  → doğrusu `…F58F946`). ethers `getAddress` bu yüzden fırlatıyordu. Fork testi
  bunu yakaladı ve `protocolConfig.js` düzeltildi.
- **ethers v6 anvil/automine'da cache takılması:** `JsonRpcProvider`, blok
  dinleyicisi yokken blok numarası ve nonce cache'ini tazelemez → `wait()` hiç
  resolve olmaz ve nonce'lar çakışır. Çözüm: `provider.on('block', () => {})`
  ile blok polling'i aktif tutmak (mainnet-fork.test.js'te uygulandı).
- **Borrow `OutOfGas`:** mainnet Aave, fork'ta gerçek oracle/rate hesaplarıyla
  Sepolia'dan daha fazla gaz yakar; connector çağrıları için 400k-500k gas
  gerekir (Sepolia'da 250k yetiyordu).
