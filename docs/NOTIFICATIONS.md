# Bildirimler (Phase 4 — C7)

Ajan, kritik olayları harici kanallara (Telegram / email) iletir. Sessizdir:
hiçbir kanal yapılandırılmadıysa tüm çağrılar no-op'tur ve ajan aynı çalışır.

## Tetiklenen olaylar

| Ajan olayı | Tür | Kaynak |
|---|---|---|
| Watchdog: cycle kilitlendi (cycleWatchdogMs aşıldı) | `alert` | `agent.js` runCycle |
| Oracle API hatası (cycle ertelendi) | `alert` | `agent.js` runCycle |
| Cycle hatası (scheduler devam ediyor) | `alert` | `agent.js` logAndBroadcastSafe |
| Onchain yürütme hataları (fail-closed mesajları dahil) | `alert` | OnchainExecution log |
| LLM/OpenRouter API hatası (deterministik fallback) | `error` | `agent.js` callLLM catch |
| Genel `alert`/`error`/`critical` log tipleri | ilgili | `logAndBroadcast` |

`info`/`scan` tipleri dışarı gönderilmez (`NOTIFIABLE_TYPES` yalnızca
`alert`, `error`, `critical`, `danger`).

## Yapılandırma

`backend/.env`'de (örnek: `.env.example`):

### Telegram
```bash
NOTIFY_TELEGRAM_TOKEN="<BotFather token>"
NOTIFY_TELEGRAM_CHAT_ID="<chat_id>"
```
- BotFather'dan token alınır; chat_id'yi öğrenmek için bota bir mesaj atıp
  `https://api.telegram.org/bot<TOKEN>/getUpdates` üzerinden okuyun.
- Teslimat: `POST https://api.telegram.org/bot<token>/sendMessage` (global fetch).

### Email (SMTP)
```bash
NOTIFY_EMAIL_HOST="smtp.example.com"
NOTIFY_EMAIL_PORT="465"            # 587 + STARTTLS için SECURE=false
NOTIFY_EMAIL_SECURE="true"
NOTIFY_EMAIL_USER="aegis@example.com"
NOTIFY_EMAIL_PASS="<app password>"
NOTIFY_EMAIL_FROM="aegis@example.com"   # boşsa USER kullanılır
NOTIFY_EMAIL_TO="ops@example.com"
```
- İstemci AUTH LOGIN, implicit TLS (465) veya STARTTLS (587) destekler;
  bağımlılıksız (`net`/`tls`).

## Tasarım

- `utils/NotificationService.js`: `NotificationService` + `TelegramTransport`
  + `SmtpTransport` + `smtpSendMail` (minimal SMTP client).
- Ajan constructor'ı `notifier` kabul eder (test enjeksiyonu); default,
  import sırasında env'den kurulan tekil `notificationService`'tir.
- `notify()` **fire-and-forget**: kanal hatası asla ajan cycle'ını durdurmaz
  (`failed` sayısına yazılır, winston'a loglanır).
- Test: `__tests__/notification-service.test.js` (sahte transport'lar —
  gerçek soket/fetch yok).

## Doğrulama

1. `npm test` (notification-service suite + tam paket).
2. Bir `alert` senaryosunu çalıştırıp kanala düşmesini kontrol edin, örn.
   watchdog tetiklemesi veya `NOTIFY_EMAIL_*` ayarlayıp LLM hatası.
