# Users & Access / Kullanıcılar ve Erişim

> **English · Türkçe**

## English

### How login works

Aegis uses **server-side sessions** (not JWTs). When you log in, the backend
stores a session in SQLite and sets an `HttpOnly` cookie in your browser — your
JavaScript never sees a token, and the session can be revoked instantly on
logout.

- Passwords are hashed with **scrypt** at OWASP parameters and the hash is
  stored with its parameters, so old hashes keep working after upgrades.
- Failed login attempts are throttled (per-account lockout + per-IP rate limit)
  with a generic error message — an attacker cannot tell whether a username
  exists.

### Two modes

| Mode | When | Behaviour |
|---|---|---|
| **Open** (single user) | Local development (`AUTH_REQUIRED=false`) | Every request runs as the `local` user; the login screen never appears |
| **Required** (multi-user) | Production (`AUTH_REQUIRED=true`, the default for `NODE_ENV=production`) | Login is mandatory; the **first registered account becomes admin** |

### Multi-user isolation

Each user's simulations, settings and logs are isolated: every query is scoped
to the owner (`WHERE user_id = ?`), and trying to reach someone else's record
returns a clean **404** (no existence leak). The agent is a single global
instance — only one simulation runs at a time and only its **owner** can
control it; other users see that it is running but not its data. Live
WebSocket streams are broadcast only to the owner.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/register` | Create an account (the first one becomes **admin**) |
| `POST /api/auth/login` / `logout` | Start / end your session |
| `GET /api/auth/me` | Current session owner |
| `GET/POST/DELETE /api/admin/users` | Admin-only user management |

### In production

- Set `AUTH_REQUIRED=true` (default in production).
- Optionally add an extra API-key gate (`AEGIS_API_KEY` + `WS_API_KEY`) for
  exposed deployments; if unset, session auth is the single layer.

---

## Türkçe

### Giriş nasıl çalışır?

Aegis **sunucu taraflı oturum** (JWT değil) kullanır. Giriş yaptığınızda arka
yüz SQLite'a bir oturum kaydeder ve tarayıcınıza `HttpOnly` bir çerez koyar —
JavaScript hiçbir zaman token görmez; çıkışta oturum anında iptal edilir.

- Şifreler OWASP parametrelerinde **scrypt** ile karma'lanır ve parametreleri
  hash ile saklanır — güncellemelerde eski hash'ler de okunmaya devam eder.
- Başarısız girişler sınırlanır (hesap başına kilitlenme + IP başına hız
  limiti) ve genel bir hata mesajı döner — saldırgan bir kullanıcı adının
  var olup olmadığını anlayamaz.

### İki mod

| Mod | Ne zaman | Davranış |
|---|---|---|
| **Açık** (tek kullanıcı) | Yerel geliştirme (`AUTH_REQUIRED=false`) | Her istek `local` kullanıcısı olarak çalışır; giriş ekranı hiç görünmez |
| **Zorunlu** (çok kullanıcı) | Üretim (`AUTH_REQUIRED=true`, `NODE_ENV=production` varsayılanı) | Giriş zorunludur; **ilk kayıt olan hesap yönetici (admin) olur** |

### Çok kullanıcılı izolasyon

Her kullanıcının simülasyonları, ayarları ve logları izoledir: her sorgu
sahibine göre sınırlandırılır (`WHERE user_id = ?`) ve başkasının kaydına
erişim denemesi temiz bir **404** döner (varlık sızıntısı olmaz). Ajan tek bir
küresel örnektir — aynı anda yalnızca bir simülasyon çalışır ve onu yalnızca
**sahibi** kontrol edebilir; diğer kullanıcılar "çalışıyor" durumunu görür ama
verisini göremez. Canlı WebSocket akışları yalnızca sahibine yayınlanır.

### Endpoint'ler

| Endpoint | Amaç |
|---|---|
| `POST /api/auth/register` | Hesap oluştur (ilk hesap **admin** olur) |
| `POST /api/auth/login` / `logout` | Oturumu başlat / bitir |
| `GET /api/auth/me` | Mevcut oturum sahibi |
| `GET/POST/DELETE /api/admin/users` | Yalnızca admin — kullanıcı yönetimi |

### Üretimde

- `AUTH_REQUIRED=true` ayarlayın (üretimde varsayılan).
- İsterseniz açık dağıtımlar için ek bir API anahtarı kapısı
  (`AEGIS_API_KEY` + `WS_API_KEY`) ekleyebilirsiniz; ayarlanmazsa oturum
  doğrulaması tek katmandır.