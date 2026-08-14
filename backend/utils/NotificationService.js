import net from 'net';
import tls from 'tls';
import logger from './logger.js';

// Log types that should fan out to external notification channels. Scan/info
// chatter is deliberately excluded so external channels only fire on things a
// human actually needs to see (Phase 4 — C7).
export const NOTIFIABLE_TYPES = new Set(['alert', 'error', 'critical', 'danger']);

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Telegram bot transport. Requires NOTIFY_TELEGRAM_TOKEN + NOTIFY_TELEGRAM_CHAT_ID.
 * Uses global fetch (Node 18+); unit tests inject a fake fetchImpl.
 */
export class TelegramTransport {
    constructor({ token, chatId, fetchImpl = null } = {}) {
        this.token = token;
        this.chatId = chatId;
        this.enabled = Boolean(token && chatId);
        this.fetchImpl = fetchImpl
            || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    }

    async send({ text }) {
        if (!this.enabled) return;
        if (!this.fetchImpl) throw new Error('TelegramTransport: no fetch implementation available');
        const res = await this.fetchImpl(`${TELEGRAM_API}/bot${this.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
        });
        if (!res.ok) throw new Error(`Telegram API HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
    }
}

/**
 * SMTP transport. Requires NOTIFY_EMAIL_HOST + NOTIFY_EMAIL_USER + NOTIFY_EMAIL_TO.
 * Supports implicit TLS (465) or STARTTLS (587). Unit tests inject a fake
 * `client` so no real socket is ever opened.
 */
export class SmtpTransport {
    constructor({ host, port, secure = true, user, pass, from, to, client = smtpSendMail } = {}) {
        this.enabled = Boolean(host && user && to);
        this.client = client;
        this.opts = { host, port, secure, user, pass, from: from || user, to };
    }

    async send({ subject, text }) {
        if (!this.enabled) return;
        await this.client({ ...this.opts, subject, text });
    }
}

export class NotificationService {
    constructor(opts = {}) {
        const env = opts.env || process.env;
        // Inject transports explicitly (tests) or build them from env.
        this.transports = opts.transports || this._fromEnv(env);
    }

    _fromEnv(env) {
        const transports = [];
        const telegram = new TelegramTransport({
            token: env.NOTIFY_TELEGRAM_TOKEN,
            chatId: env.NOTIFY_TELEGRAM_CHAT_ID,
        });
        if (telegram.enabled) transports.push(telegram);
        const smtp = new SmtpTransport({
            host: env.NOTIFY_EMAIL_HOST,
            port: env.NOTIFY_EMAIL_PORT || (env.NOTIFY_EMAIL_SECURE === 'false' ? 587 : 465),
            secure: env.NOTIFY_EMAIL_SECURE !== 'false',
            user: env.NOTIFY_EMAIL_USER,
            pass: env.NOTIFY_EMAIL_PASS,
            from: env.NOTIFY_EMAIL_FROM,
            to: env.NOTIFY_EMAIL_TO,
        });
        if (smtp.enabled) transports.push(smtp);
        return transports;
    }

    get enabled() {
        return this.transports.some((t) => t.enabled !== false);
    }

    /**
     * Fire-and-forget by design: never rejects, never throws into the agent
     * cycle. Returns { sent, failed }. Type must be in NOTIFIABLE_TYPES,
     * otherwise (or with no enabled channel) it is a no-op.
     */
    async notify(type, message, details = null) {
        if (!NOTIFIABLE_TYPES.has(type)) return { sent: 0, failed: 0 };
        const channels = this.transports.filter((t) => t.enabled !== false);
        if (channels.length === 0) return { sent: 0, failed: 0 };

        const ts = new Date().toISOString();
        const detail = details ? `\n${JSON.stringify(details)}` : '';
        const text = `[${type.toUpperCase()}] ${ts}\n${message}${detail}`;
        const subject = `Aegis ${type.toUpperCase()}: ${String(message).slice(0, 120)}`;
        logger.info(`[NOTIFY] ${type}: ${message}`);

        let sent = 0;
        let failed = 0;
        await Promise.all(channels.map(async (t) => {
            try {
                await t.send({ text, subject });
                sent += 1;
            } catch (err) {
                failed += 1;
                logger.error(`[NOTIFY] ${t.constructor.name} delivery failed: ${err.message}`);
            }
        }));
        return { sent, failed };
    }
}

// Process-wide singleton — reads env once at import time.
export const notificationService = new NotificationService();

/**
 * Minimal SMTP client (AUTH LOGIN, implicit TLS or STARTTLS) with no external
 * dependency. Only exercised when email is actually configured; unit tests use
 * a fake client, so this path is covered by docs rather than unit tests.
 */
export function smtpSendMail({ host, port = 465, secure = true, user, pass, from, to, subject, text }) {
    return new Promise((resolve, reject) => {
        let current = null;
        let buffer = '';
        let nextStep = null;

        const finish = (err) => {
            try { if (current) current.destroy(); } catch (_) { /* ignore */ }
            return err ? reject(err) : resolve();
        };

        const onData = (chunk) => {
            buffer += chunk.toString();
            let idx;
            while ((idx = buffer.indexOf('\r\n')) !== -1) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                if (/^\d{3} /.test(line) && nextStep) nextStep(line);
            }
        };

        const attach = (sock) => {
            sock.setTimeout(15000);
            sock.on('timeout', () => finish(new Error('SMTP timeout')));
            sock.on('error', (err) => finish(err));
            sock.on('data', onData);
        };

        const connectImplicitTls = () => new Promise((res, rej) => {
            const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, res);
            sock.once('error', rej);
            attach(sock);
            current = sock;
        });

        const connectPlain = () => new Promise((res, rej) => {
            const sock = net.connect({ host, port }, res);
            sock.once('error', rej);
            attach(sock);
            current = sock;
        });

        const connectStartTls = () => new Promise((res, rej) => {
            const sock = tls.connect({ socket: current, servername: host, rejectUnauthorized: false }, res);
            sock.once('error', rej);
            attach(sock);
            current = sock;
        });

        const write = (line) => current.write(line + '\r\n');

        const expect = (code) => new Promise((res, rej) => {
            nextStep = (line) => {
                nextStep = null;
                if (!line.startsWith(String(code))) return rej(new Error(`SMTP expected ${code}, got: ${line}`));
                return res(line);
            };
        });

        (async () => {
            try {
                const conn = secure ? connectImplicitTls() : connectPlain();
                await conn;
                await expect(220);
                write(`EHLO aegis`);
                const ehlo = await expect(250);

                if (!secure && /STARTTLS/i.test(ehlo)) {
                    write('STARTTLS');
                    await expect(220);
                    await connectStartTls();
                    write(`EHLO aegis`);
                    await expect(250);
                }

                write('AUTH LOGIN');
                await expect(334);
                write(Buffer.from(user).toString('base64'));
                await expect(334);
                write(Buffer.from(pass || '').toString('base64'));
                await expect(235);

                write(`MAIL FROM:<${from}>`);
                await expect(250);
                write(`RCPT TO:<${to}>`);
                await expect(250);
                write('DATA');
                await expect(354);
                const body = text.replace(/^\./gm, '..');
                const msg = [
                    `From: ${from}`,
                    `To: ${to}`,
                    `Subject: ${subject}`,
                    'MIME-Version: 1.0',
                    'Content-Type: text/plain; charset=utf-8',
                    'Content-Transfer-Encoding: 8bit',
                    '',
                    body,
                ].join('\r\n');
                write(msg + '\r\n.');
                await expect(250);
                write('QUIT');
                await expect(221);
                finish();
            } catch (err) {
                finish(err);
            }
        })();
    });
}
