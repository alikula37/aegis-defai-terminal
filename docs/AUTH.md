# Kimlik Doğrulama ve Çok Kullanıcılı İzolasyon (Phase 4 — E9)

## Model

**Server-side session** (JWT değil) — OWASP Session Management / JWT cheat
sheet'leri ve Copenhagen Book'un tek sunuculu uygulamalar için önerdiği model:

- Giriş → SQLite `sessions` tablosuna satır + **HttpOnly; SameSite=Lax;
  Secure(prod)** çerez (`aegis_session`). Token `crypto.randomBytes(32)` olup
  DB'de **sha256 hash'i** saklanır (DB sızıntısı ≠ oturum hırsızlığı).
- Çıkış / yetki iptali = satırı sil (anında; JWT denylist mekanizması yok).
- Şifreler: `crypto.scrypt` N=2^17, r=8, p=1, 128 MiB (Node maxmem ayarı),
  parametreler hash içinde saklanır. Argon2id'ye geçişte eski hash'ler okunmaya
  devam eder (parametreler gömülü).
- Brute force: hesap başına kilitleme (5 hata → 15 dk), login rate limit
  (20/15dk/IP), generic hata mesajı + bilinmeyen kullanıcı için dummy hash
  doğrulaması (timing sızıntısı yok), `crypto.timingSafeEqual`.
- CSRF/CSWSH: SameSite=Lax + state değiştiren isteklerde Origin allowlist
  kontrolü (token mekanizması gereksiz — OWASP custom-header pattern'i).

## Modlar

| Mod | Değer | Davranış |
|---|---|---|
| Açık (tek kullanıcı) | `AUTH_REQUIRED=false` (dev varsayılanı) | Her istek `local` kullanıcısı olarak çalışır; login ekranı hiç görünmez. E9 öncesi davranışın aynısı. |
| Zorunlu | `AUTH_REQUIRED=true` (production varsayılanı) | Login zorunlu; tüm `/api` (auth hariç) geçerli session ister; veri kullanıcıya göre izole. |

Varsayılan: `NODE_ENV=production` ise `true`, değilse `false`.

## Endpoint'ler

| Endpoint | Açıklama |
|---|---|
| `POST /api/auth/register` | İlk hesap **admin** olur; sonrakiler `user`. 3-32 karakter kullanıcı adı, 8-128 karakter şifre. |
| `POST /api/auth/login` | Başarıda session çerezi kurar. Hatalar generic döner. |
| `POST /api/auth/logout` | Session'ı siler, çerezi temizler, kullanıcının WS soketlerini kapatır. |
| `GET /api/auth/me` | Oturum sahibini döner; 401 = login sayfasına yönlendir. |
| `GET/POST/DELETE /api/admin/users` | Admin-only kullanıcı yönetimi (kendi hesabını ve `local`'i silemez). |

## Veri izolasyonu

- `simulations` ve `settings` tablolarında `user_id` sütunu (FK + index).
- E9 öncesi tüm satırlar `local` kullanıcısına backfill edilir (idempotent,
  boot'ta).
- Her sorgu `WHERE user_id = ?` taşır (`requireUserId` ile userId zorunlu).
  Başkasının satırına erişim denemesi **404** döner (varlık sızıntısı yok).
- `portfolio_stats`/`agent_logs`/`decision_memory` ana simülasyon üzerinden
  izole: çocuk kayıtlar yalnızca sahibinin sim'sinden okunur/yazılır.
- Simülasyon adı benzersizliği, prune ("son 5"), silme — tamamı kullanıcı
  kapsamlı.
- `market_history`/backtest bilinçli olarak küreseldir (kamu piyasa verisi).

## Tek ajan modeli (bilinçli kapsam)

Ajan tek global örnektir: aynı anda yalnızca bir simülasyon çalışır ve onun
**sahibi** tarafından kontrol edilebilir (start/stop/reset/delete). Diğer
kullanıcılar "çalışıyor" durumunu görür, verisini göremez. WS akışları
`Map<userId, Set<ws>>` ile sahibine özel yayınlanır; logout'ta kapatılır.
Kullanıcı başına eşzamanlı ajanlar (agentState/SimulationExecution context
refactor'ü) gelecek iterasyon.

## WS

- Handshake'te session çerezi doğrulanır (geçersizse 1008 ile kapanır).
- `simulation_status` tüm kullanıcılara; `portfolio_update`/`agent_log`/
  `notification` yalnızca aktif sim'in sahibine.
- Açık modda her soket `local` kullanıcısındadır (eski davranış).

## Frontend

- `AuthContext`: açılışta `/api/auth/me`; 401 → login ekranı, açık modda asla.
- `LoginPage`, TopNav'da kullanıcı çipi + çıkış.
- JS **hiçbir token göremez** (HttpOnly çerez); `apiFetch` `credentials:
  'include'` kullanır.
- Eski `x-api-key` (Settings sayfası) açık modda çalışmaya devam eder.

## Production notları

- `AUTH_REQUIRED=true` (production varsayılanı). İstersen ek katman olarak
  `AEGIS_API_KEY` de set edilebilir; set edilmezse session auth tek katmandır
  (eski fail-closed yazma guard'ı session varken devre dışı).
- `WS_API_KEY` zorunlu modda yok sayılır (cookie esas).
- Şifre hash maliyeti ~100ms/scrypt — login için normal.

## Testler

`backend/__tests__/auth.test.js` (11): session çerezi flag'leri, generic hata,
kilitleme, register, logout, RBAC, self/local silme koruması, Origin check,
açık mod. `database.test.js` (16): kullanıcı/session fonksiyonları, per-user
izolasyon, prune, settings scoping.
