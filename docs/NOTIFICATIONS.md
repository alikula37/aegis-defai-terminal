# Alerts & Notifications / Bildirimler

> **English · Türkçe**

## English

The agent can send you an alert on **Telegram** or **email** when something
critical happens. It is silent by default: if no channel is configured, all
calls are no-ops and the agent runs exactly the same.

### What triggers an alert

| Event | Type |
|---|---|
| Agent cycle watchdog fired (a cycle got stuck) | `alert` |
| Oracle API error (cycle postponed) | `alert` |
| Cycle error (scheduler continues) | `alert` |
| On-chain execution errors (including fail-closed messages) | `alert` |
| LLM/OpenRouter API error (deterministic fallback used) | `error` |
| Any `alert` / `error` / `critical` / `danger` log | as logged |

Ordinary `info` / `scan` messages are **never** sent out — you only hear about
things a human actually needs to see.

### Configuration (`backend/.env`)

**Telegram**
```bash
NOTIFY_TELEGRAM_TOKEN="<BotFather token>"
NOTIFY_TELEGRAM_CHAT_ID="<chat_id>"
```
Get the token from [@BotFather](https://t.me/BotFather); to find your chat_id,
send a message to your bot and read it from
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

**Email (SMTP)**
```bash
NOTIFY_EMAIL_HOST="smtp.example.com"
NOTIFY_EMAIL_PORT="465"            # 587 + STARTTLS için SECURE=false
NOTIFY_EMAIL_SECURE="true"
NOTIFY_EMAIL_USER="aegis@example.com"
NOTIFY_EMAIL_PASS="<app password>"
NOTIFY_EMAIL_FROM="aegis@example.com"   # optional; defaults to USER
NOTIFY_EMAIL_TO="ops@example.com"
```
Supports implicit TLS (465) or STARTTLS (587), with certificate validation **on
by default** (set `SMTP_ALLOW_INVALID_CERTS=true` only for a trusted private
relay).

### Design notes

- Notifications are **fire-and-forget**: a channel error never stops the agent
  cycle.
- Implementation: `backend/utils/NotificationService.js`
  (`TelegramTransport` + `SmtpTransport`, no external dependencies).

---

## Türkçe

Ajan, kritik bir olay olduğunda size **Telegram** veya **e-posta** ile bildirim
gönderebilir. Varsayılan olarak sessizdir: hiçbir kanal yapılandırılmadıysa tüm
çağrılar no-op'tur ve ajan aynı şekilde çalışır.

### Hangi olaylar bildirim tetikler

| Olay | Tür |
|---|---|
| Watchdog tetiklendi (cycle takıldı) | `alert` |
| Oracle API hatası (cycle ertelendi) | `alert` |
| Cycle hatası (zamanlayıcı devam ediyor) | `alert` |
| Onchain yürütme hataları (fail-closed mesajları dahil) | `alert` |
| LLM/OpenRouter API hatası (deterministik yedek kullanıldı) | `error` |
| Herhangi bir `alert` / `error` / `critical` / `danger` logu | ilgili tür |

Sıradan `info` / `scan` mesajları **asla** dışarı gönderilmez — yalnızca bir
insanın gerçekten görmesi gereken şeyleri duyarsınız.

### Yapılandırma (`backend/.env`)

**Telegram**
```bash
NOTIFY_TELEGRAM_TOKEN="<BotFather token>"
NOTIFY_TELEGRAM_CHAT_ID="<chat_id>"
```
Token'i [@BotFather](https://t.me/BotFather)'dan alın; chat_id'yi öğrenmek için
botunuza bir mesaj atıp
`https://api.telegram.org/bot<TOKEN>/getUpdates` üzerinden okuyun.

**E-posta (SMTP)**
```bash
NOTIFY_EMAIL_HOST="smtp.example.com"
NOTIFY_EMAIL_PORT="465"            # 587 + STARTTLS için SECURE=false
NOTIFY_EMAIL_SECURE="true"
NOTIFY_EMAIL_USER="aegis@example.com"
NOTIFY_EMAIL_PASS="<uygulama şifresi>"
NOTIFY_EMAIL_FROM="aegis@example.com"   # opsiyonel; USER kullanılır
NOTIFY_EMAIL_TO="ops@example.com"
```
Implicit TLS (465) veya STARTTLS (587) desteklenir; sertifika doğrulaması
varsayılan **açıktır** (yalnızca güvenilir özel bir relay için
`SMTP_ALLOW_INVALID_CERTS=true` ayarlayın).

### Tasarım notları

- Bildirimler **fire-and-forget**: bir kanal hatası asla ajan cycle'ını
  durdurmaz.
- Uygulama: `backend/utils/NotificationService.js`
  (`TelegramTransport` + `SmtpTransport`, harici bağımlılık yok).