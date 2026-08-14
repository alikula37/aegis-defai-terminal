# 🧠 Aegis DeFAI Terminal: Derinlemesine Sistem Mimarisi

```mermaid
graph TD
    subgraph Oracle Katmanı
        A[DeFiLlama API] -->|Fiyatlar & Getiriler| B(OracleService)
        C[Çapraz Zincir Verisi] -->|L2 Borçlanma Oranları| B
    end

    subgraph Risk Motoru
        B --> D{Sağlık Faktörü Kontrolü}
        D -->|HF > 1.5| E[Güvenli Bölge: Getiriyi Maksimize Et]
        D -->|1.2 < HF < 1.5| F[Uyarı Bölgesi: Borçlanmayı Durdur]
        D -->|HF < 1.2| G[Kritik Bölge: Likidasyon Riski]
    end

    subgraph Yapay Zeka Beyni (LLM)
        F --> H((Llama 3.1 70B))
        G --> H
        H -->|Bağlamı Analiz Et| I{Karar}
        I -->|Hold| J[Piyasanın Toparlanmasını Bekle]
        I -->|Kısmi Kaldıraç Düşürme| K[%25 Pozisyon Kapat]
        I -->|Flash Loan Kurtarma| L[Aave Flash Loan Çalıştır]
    end

    subgraph Uygulama Katmanı
        E --> M[Stratejilere Fon Dağıt]
        K --> N[Akıllı Kontrat İşlemi]
        L --> N
        M --> O[(SQLite Hafıza)]
        N --> O
    end
```

Aegis DeFAI Terminal, sadece basit bir "borç al / borç ver" botu değildir. Kurumsal seviyede (institutional-grade) risk yönetimi yapan, piyasa verilerini anlık olarak analiz eden ve yapay zeka (LLM) destekli kararlar alan otonom bir **Delta-Neutral (Piyasa Yönünden Bağımsız)** getiri (yield) ajanıdır.

İşte sistemin kaputunun altındaki detaylı çalışma mantığı:

---

## 1️⃣ Veri Toplama ve Çapraz Zincir (Cross-Chain) Analizi 📡
Sistem her döngüde (varsayılan 15 saniye) piyasanın nabzını tutar. Sadece Ethereum ana ağını değil, Layer-2 (L2) ağlarını da tarar.

*   **Fiyat ve Getiri (Yield) Oracles:** DeFiLlama API'leri üzerinden ETH, USDC ve sUSDe fiyatlarını; Ethena, Pendle, Morpho Blue ve Aave havuzlarındaki anlık APY (Yıllık Getiri Oranı) verilerini toplar.
*   **Cross-Chain Arbitrage (Çapraz Zincir Fırsatları):** Sistem, Ethereum ana ağındaki borçlanma maliyetleri (örneğin Morpho Blue'da %5) ile L2 ağlarındaki (Arbitrum veya Base üzerindeki Aave V3) borçlanma maliyetlerini karşılaştırır. Eğer L2'de borçlanmak, köprü (bridge) maliyetlerini çıkardıktan sonra bile daha kârlıysa, ajan fonları o ağa taşımayı değerlendirir.

---

## 2️⃣ Gelişmiş DeFi Stratejileri (Portfolio Allocation) 💼
Ajan, sermayeyi tek bir sepete koymaz. Riski dağıtmak ve getiriyi maksimize etmek için fonları 5 farklı gelişmiş stratejiye böler:

### 🎯 1. Pendle PT-sUSDe Arbitrajı (Portföyün %55'i)
*   **Mantık:** Aave V4 E-Mode veya Morpho Blue üzerinden düşük faizle USDC borç alınır. Bu USDC, Ethena'nın sUSDe'sine çevrilir ve Pendle Finance üzerinde **PT-sUSDe (Principal Token)** alınarak sabit ve yüksek bir getiriye kilitlenir.
*   **Neden?** Borçlanma maliyeti ile Pendle'ın sunduğu sabit getiri arasındaki fark (spread) risksiz bir kâr (arbitraj) yaratır.

### 🏢 2. PT-syrupUSDC RWA (Gerçek Dünya Varlıkları) (Portföyün %20'si)
*   **Mantık:** Maple Finance gibi kurumsal RWA (Real World Assets) protokollerinin sunduğu sabit getirili tokenlar (syrupUSDC) kullanılır. Aave V4 üzerinden muhafazakar bir kaldıraç (4x) ile bu risksiz getiri katlanır.
*   **Neden?** Kripto piyasasındaki dalgalanmalardan tamamen bağımsız, ABD Hazine Bonosu destekli gerçek dünya getirisi sağlar.

### 🚀 3. Ethena sUSDe Kaldıraçlı İşlem (Portföyün %15'i)
*   **Mantık:** Morpho Blue üzerinde sUSDe teminat gösterilerek USDC borç alınır, alınan USDC tekrar sUSDe'ye çevrilir (Looping).
*   **Neden?** Ethena'nın sunduğu yüksek APY'yi ve ENA airdrop puanlarını (Points) maksimize etmek için orta riskli bir kaldıraç stratejisidir.

### 🛡️ 4. Pendle Boros YU Hedge (Portföyün %5'i)
*   **Mantık:** Ethena'nın getirisi, sürekli vadeli işlemlerdeki (perpetual futures) fonlama oranlarına (funding rates) bağlıdır. Fonlama oranları negatife düşerse sUSDe getirisi azalır. Ajan, Pendle Boros (Yield Utility) üzerinden bu riski hedge eder (sigortalar).
*   **Neden?** Piyasa çöktüğünde ve fonlama oranları negatife döndüğünde bile portföyün zarar etmesini engeller.

### 💧 5. Morpho USDC Revolver (Portföyün %5'i)
*   **Mantık:** Portföyün küçük bir kısmı her zaman likit olarak Morpho Blue'da USDC arzı (supply) olarak tutulur.
*   **Neden?** Acil durumlarda (flash loan kurtarmaları veya ani teminat tamamlama çağrıları) kullanılmak üzere hazırda bekleyen, aynı zamanda düşük de olsa getiri sağlayan bir "acil durum fonu"dur.

---

## 3️⃣ Dinamik Risk Motoru ve Sağlık Faktörü (HF) 🧮
Kaldıraçlı işlemler likidasyon (patlama) riski taşır. Ajan, bu riski saniye saniye hesaplar.

*   **Dinamik HF Hesaplaması:** `HF = (Teminat Değeri * Likidasyon Eşiği) / Borç Değeri` formülü ile hesaplanır. Teminatın (sUSDe) fiyatı anlık olarak Oracle'dan alınır.
*   **Risk Bölgeleri:**
    *   🟢 **Güvenli (Safe):** HF > 1.5 (Ajan agresif getiri aramaya devam eder).
    *   🟡 **Uyarı (Warning):** HF 1.2 - 1.5 arası (Ajan yeni borç almayı durdurur).
    *   🔴 **Kritik (Critical):** HF < 1.2 (Likidasyon tehlikesi! Acil müdahale gerekir).

---

## 4️⃣ Yapay Zeka Karar Mekanizması (LLM Katmanı) 🤖
Eğer portföy **Uyarı** veya **Kritik** seviyeye düşerse, sistem klasik botlar gibi panik satışı yapmaz. Durumu toparlamak için Llama 3.1 70B (veya seçtiğiniz başka bir model) yapay zekasına danışır.

Yapay zekaya şu bilgiler gönderilir:
> *"Şu anki Sağlık Faktörümüz 1.15. Kritik bölgedeyiz. Elimde şu kadar sUSDe teminatı, şu kadar USDC borcu ve şu kadar acil durum likiditesi var. Ne yapmalıyım?"*

Yapay zeka durumu analiz eder ve şu aksiyonlardan birini seçer:
*   ✅ **HOLD:** "Piyasadaki düşüş anlık bir iğne (wick), tasfiye seviyesine daha var, bekle."
*   ⚠️ **PARTIAL_DELEVERAGE:** "Riski azaltmak için Ethena kaldıraç pozisyonunun %25'ini boz ve borcu kapa."
*   🚨 **FLASH_LOAN_RESCUE:** "Acil durum! Aave'den Flash Loan (anında kredi) çek, borcu tamamen kapat, teminatı kurtar ve Flash Loan'ı geri öde."

*Bu kararlar, ajanın sadece kodlanmış kurallara göre değil, piyasa bağlamına göre hareket etmesini sağlar.*

---

## 5️⃣ Hafıza ve Canlı İzleme (Execution & Memory) ⚡
*   **Hafıza (Memory):** Ajanın aldığı her karar, gerekçesiyle birlikte SQLite veritabanına (`decision_memory` tablosu) kaydedilir.
*   **Canlı İzleme (Frontend):** Siz, arkanıza yaslanıp tüm bu karmaşık süreci modern bir arayüzden izlersiniz. Toplam kilitli varlığınızı (TVL), anlık APY'nizi, aktif zinciri (Ethereum/Arbitrum) ve ajanın o an ne düşündüğünü Matrix ekranı gibi akan bir terminalden takip edersiniz.
