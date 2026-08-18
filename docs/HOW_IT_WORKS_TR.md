# 🧠 Aegis DeFAI Terminal — Nasıl Çalışır?

Aegis, **delta-nötr** getiri (yield) toplayan ve pozisyonunuzu likidasyondan
koruyan **otonom, yapay zeka destekli bir DeFi ajanıdır** — 7/24 çalışır.
Sadece "borç al / borç ver" yapmaz: piyasayı izler, riski bir LLM ile
değerlendirir ve sizin adınıza harekete geçer.

```mermaid
graph TD
    subgraph Veri Katmanı
        A[Canlı oracle'lar / DeFiLlama] --> B[Piyasa Özeti]
        C[Stokastik SIM motoru] --> B
    end

    subgraph Risk Motoru
        B --> D{Sağlık Faktörü Kontrolü}
        D -->|HF ≥ uyarı eşiği| E[Güvenli Bölge: getiriyi maksimize et]
        D -->|kritik ≤ HF < uyarı| F[Uyarı Bölgesi: yeni borç durdur]
        D -->|HF < kritik| G[Kritik Bölge: kurtarma aksiyonu]
    end

    subgraph Yapay Zeka Beyni (LLM)
        E --> H((Seçtiğiniz model))
        F --> H
        G --> H
        H -->|salt-okunur araçlar + bağlam| I{Karar}
        I -->|hold| J[Pozisyonu koru]
        I -->|adjust_portfolio| K[LTV / teminat ayarla]
        I -->|reallocate_capital| L[Loop / Basis / JIT dağılımı]
        I -->|flash_loan_rescue| M[Acil flash loan]
    end

    subgraph Uygulama ve Hafıza
        J --> N[Planı uygula]
        K --> N
        L --> N
        M --> N
        N --> O[(SQLite hafıza)]
        B --> O
    end
```

## 1. Veri — canlı oracle'lar veya stokastik simülasyon

Ajan her döngüde (varsayılan 15 saniye) bir **piyasa özeti** oluşturur:

- **LIVE modu (varsayılan):** ETH, USDC ve sUSDe için gerçek fiyatlar ve APY'ler;
  DeFiLlama havuzlarından (Ethena, Pendle, Morpho Blue) canlı oranlar ve
  zincir üstü borçlanma oranları.
- **SIM modu:** **stokastik simülasyon motoru** aynı piyasayı Ornstein-Uhlenbeck
  süreçleri, GBM ETH fiyat yolu ve ilişkili şoklarla modeller — sUSDe için
  kademeli bir **depeg senaryosu** dahil. Simülasyon tamamen **seed'lenebilir**:
  aynı seed + senaryo her zaman aynı yolu üretir; bu da backtest ve kantitatif
  katmanın deterministik ve doğrulanabilir olmasını sağlar.

Aynı özet risk motorunu, LLM'i ve panoyu besler — böylece her karar
açıklanabilirdir.

## 2. Strateji — üç delta-nötr yapı taşı

Sermaye üç yapı taşı arasında bölünür; ajan koşullara göre bunlar arasında
yeniden dağıtım yapar:

| Yapı taşı | Ne yapar | Risk |
|---|---|---|
| **Loop** | sUSDe/PT-sUSDe teminata karşı USDC borç alıp tekrar döngüye sokar — delta-nötr getiri motoru | Orta |
| **Basis** | Ethena'nın fonlama oranı riskini hedge eder (sigorta bacağı) | Düşük (hedge) |
| **JIT** | Boşta duran fonlarla Uniswap'te konsantre likidite sağlar | Düşük–orta |

Varsayılan dağılım **%100 Loop** ile başlar; ajan, birleşik net APY'yi maksimize
etmek için `reallocate_capital` kararıyla yapı taşları arasında geçiş yapabilir.

## 3. Risk motoru — Sağlık Faktörü (HF)

Kaldıraç likidasyon riski demektir; bu yüzden ajan her döngüde **Sağlık
Faktörünü** (HF) hesaplar:

```
HF = (Teminat Değeri × Likidasyon Eşiği) / Borç Değeri
```

Risk bölgeleri, **risk iştahınıza** göre belirlenir — yeni simülasyon başlatma
ekranında veya **Ayarlar sayfasında** seçilir; ikisi her zaman senkrondur.
İştah seçmek Hedef Sağlık Faktörünü hazır değerine sabitler; Hedef HF'yi elle
düzenlemek de iştah etiketini yeniden türetir (Muhafazakâr 1.40 · Dengeli 1.25 ·
Agresif 1.20). Ajan bu değeri her döngüde uygular; böylece Genel Bakış paneli,
Ayarlar ve simülasyonun gerçek risk bölgeleri asla birbirinden sapmaz:

| İştah | Hedef HF | Uyarı bölgesi | Kritik |
|---|---|---|---|
| **Muhafazakar** | 1.40 | 1.30 – 1.40 | < 1.25 |
| **Dengeli** (varsayılan) | 1.25 | 1.21 – 1.25 | < 1.15 |
| **Agresif** | 1.20 | 1.15 – 1.20 | < 1.10 |

- 🟢 **Güvenli (HF ≥ uyarı):** ajan getiriyi maksimize etmeye devam eder.
- 🟡 **Uyarı:** yeni borç alınmaz, pozisyon sıkılaştırılır.
- 🔴 **Kritik:** ajan kurtarma aksiyonu başlatır (aşağıda).

## 4. Yapay zeka beyni — sizin modeliniz, araçları

AI beyni **varsayılan olarak isteğe bağlı ve krediden bağımsızdır**. Ayarlarda
**ve yeni simülasyon başlatma ekranında** üç **Beyin Modu** vardır:

| Mod | Davranış |
|---|---|
| **Otomatik** *(varsayılan)* | Seçtiğiniz modeli dener (önce ücretsiz modeller). OpenRouter ulaşılamazsa, *Payment Required* (kredi yok) dönerse veya anahtar eksikse ajan **otomatik olarak yerleşik kural motoruna düşer** — çökme veya spam yok. |
| **Yalnızca Yerel** | OpenRouter hiç çağrılmaz — saf kural tabanlı motor. **API anahtarı ve sıfır bakiyeyle** canlı veride çalışır. |
| **Yalnızca AI** | Her zaman LLM'e danışır; kredili geçerli bir anahtar gerektirir. |

Ayarlardaki tek tık **"Ücretsiz çalıştır — kredi gerekmez"** düğmesi, en iyi
ücretsiz modelle Otomatik moda geçer. Hatalar tek bir dostça bildirime
sıkıştırılır (10 dakikada en fazla bir kez) ve her döngü yine de deterministik
bir karar üretir.

Portföy **Uyarı** veya **Kritik** bölgeye girdiğinde (veya bir karar noktası
oluştuğunda) ajan **OpenRouter** üzerinden bir LLM'e danışır. Modeli **Ayarlar**
sayfasındaki ve yeni simülasyon başlatma ekranındaki **aynı seçiciden**
seçersiniz (ücretsiz modeller en üstte sabittir, ardından satıcıya göre
gruplanmış canlı OpenRouter kataloğu ve özel kimlikleriniz gelir). Varsayılan
**ücretsiz** bir modeldir (`google/gemini-2.5-flash-exp:free`); iki ekrandan
hangisinde seçerseniz seçin ajan onu kullanır — ekranlar asla sapmaz.

Prompt, mevcut durumun tamamını (HF, LTV, dağılımlar, APY'ler, spread, TVL) ve
salt-okunur araçlarının raporlarını (`get_market_snapshot`,
`get_historical_yields`, `run_backtest`, …) içerir. Model şu kararlardan
birini verir:

| Karar | Anlamı |
|---|---|
| `hold` | Piyasa istikrarlı, pozisyonu koru |
| `adjust_portfolio` | LTV veya teminat türünü değiştir |
| `reallocate_capital` | Loop / Basis / JIT arasında geçiş yap |
| `flash_loan_rescue` | **Kritik:** flash loan al, borcu kapat, teminatı kurtar |
| `claim` | Biriken kârı, gaz maliyetini aştığında çek |
| `migrate_borrow` / `cross_chain_migrate` | Borçlanmayı daha ucuz orana taşı |

Araç çağrıları ve LLM tur sayısı **bütçelidir** (döngü başına azami çağrı,
azami araç turu) — kötü bir yanıt asla ajanı kilitleyemez.

## 5. Uygulama ve hafıza

- **Yürütme modu:** `simulation` (varsayılan, gerçek para yok) veya `onchain`
  (Sepolia / yerel mainnet fork — provider ve signer yapılandırılmazsa ajan
  işlem yapmayı **reddeder**).
- **Hafıza:** her karar, gerekçesi ve ortaya çıkan portföy durumu SQLite'a
  kaydedilir (`decision_memory`, `portfolio_history`, `agent_logs`) — tüm geçmiş
  yeniden oynatılabilir.

## 6. Veri bilimi katmanı (pano)

Terminal performansı ölçer — sadece grafik değildir:

- **Risk metrikleri** (`/api/portfolio/metrics`): Sharpe & Sortino oranları,
  yıllıklandırılmış volatilite, maksimum düşüş, **Value at Risk (VaR)** ve
  **CVaR**, kazanma oranı ve beta — simülasyonun gözlemlenen geçmişi üzerinden.
- **Getiri tahmini** (`/api/forecast/:metric`): net APY ve TVL için EWMA
  volatilite bantlı Holt doğrusal trend projeksiyonu. Bu bir **eğitim tahminidir,
  vaat değildir** (arayüzde açıkça belirtilir).
- **Backtest** (`/api/backtest`): %80/20 örneklem dışı (out-of-sample) ayrımı,
  bootstrap güven aralıkları ve aynı risk metrikleriyle tarihsel senaryolar.
- **Terim sözlüğü (Glossary)**: her finansal terimin üzerine gelince açıklama
  ipucu belirir (HF, APY, TVL, spread, delta-nötr, kaldıraç, LTV, Sharpe, VaR,
  …) — İngilizce ve Türkçe.

## 7. Pano (Dashboard)

Web terminali (localhost:5173) beş sayfadan oluşur:

| Sayfa | Ne görürsünüz |
|---|---|
| **Overview (Genel Bakış)** | Canlı TVL, net APY, sağlık faktörü, risk bölgesi, tahmin grafiği + risk metriği kartları ve başlat/durdur kontrolleri |
| **Yield Strategies** | Sermayenin yapı taşları arasında nasıl dağıldığı |
| **Live Data** | Gerçek zamanlı piyasa verisi, borçlanma oranları, çapraz zincir fırsatları |
| **AI Agent Logs** | Canlı "ajan konsolu" — AI neye karar verdi ve neden, gerçek zamanlı akar |
| **Settings (Ayarlar)** | API anahtarlarınız (şifreli saklanır), model seçimi ve risk iştahı |

> Arayüz **İngilizce** ve **Türkçe** sunulur ve her sayının arkasında düz dille
> bir açıklama ipucu vardır — terminal sadece göstermek için değil, öğretmek
> için tasarlanmıştır.