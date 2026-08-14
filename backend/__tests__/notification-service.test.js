import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    NotificationService,
    TelegramTransport,
    SmtpTransport,
    NOTIFIABLE_TYPES,
} from '../utils/NotificationService.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const makeTelegram = (fetchImpl) => new TelegramTransport({
    token: 'tok_123',
    chatId: 'chat_1',
    fetchImpl,
});

describe('NotificationService (C7)', () => {
    it('is a no-op when no channel is configured', async () => {
        const svc = new NotificationService({ env: {} });
        expect(svc.enabled).toBe(false);
        const res = await svc.notify('alert', 'boom');
        expect(res).toEqual({ sent: 0, failed: 0 });
    });

    it('builds transports from env when configured', () => {
        const svc = new NotificationService({
            env: { NOTIFY_TELEGRAM_TOKEN: 't', NOTIFY_TELEGRAM_CHAT_ID: 'c' },
        });
        expect(svc.enabled).toBe(true);
        expect(svc.transports).toHaveLength(1);
        expect(svc.transports[0]).toBeInstanceOf(TelegramTransport);
    });

    it('only fans out notifiable types', async () => {
        const send = vi.fn(async () => {});
        const svc = new NotificationService({
            transports: [{ enabled: true, send, constructor: { name: 'Fake' } }],
        });
        const info = await svc.notify('info', 'scan chatter');
        expect(info.sent).toBe(0);
        expect(send).not.toHaveBeenCalled();
        const scan = await svc.notify('scan', 'still chatter');
        expect(scan.sent).toBe(0);
        expect(send).not.toHaveBeenCalled();
        expect(NOTIFIABLE_TYPES.has('alert')).toBe(true);
        expect(NOTIFIABLE_TYPES.has('error')).toBe(true);
        expect(NOTIFIABLE_TYPES.has('info')).toBe(false);
    });

    it('delivers to every enabled channel and reports sent count', async () => {
        const sendA = vi.fn(async () => {});
        const sendB = vi.fn(async () => {});
        const svc = new NotificationService({
            transports: [{ enabled: true, send: sendA, constructor: { name: 'A' } },
                          { enabled: true, send: sendB, constructor: { name: 'B' } }],
        });
        const res = await svc.notify('alert', 'HF critical', { hf: 1.04 });
        expect(res.sent).toBe(2);
        expect(res.failed).toBe(0);
        expect(sendA).toHaveBeenCalledWith(expect.objectContaining({
            text: expect.stringContaining('[ALERT]'),
            subject: expect.stringContaining('Aegis ALERT'),
        }));
        expect(sendB).toHaveBeenCalled();
    });

    it('never throws when a channel fails; counts it as failed', async () => {
        const failing = { enabled: true, send: vi.fn(async () => { throw new Error('nope'); }), constructor: { name: 'F' } };
        const ok = { enabled: true, send: vi.fn(async () => {}), constructor: { name: 'O' } };
        const svc = new NotificationService({ transports: [failing, ok] });
        const res = await svc.notify('error', 'delivery test');
        expect(res.sent).toBe(1);
        expect(res.failed).toBe(1);
    });

    it('skips disabled transports', async () => {
        const send = vi.fn(async () => {});
        const svc = new NotificationService({
            transports: [{ enabled: false, send, constructor: { name: 'D' } }],
        });
        const res = await svc.notify('critical', 'x');
        expect(res.sent).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('TelegramTransport (C7)', () => {
    it('POSTs to the bot sendMessage endpoint and validates ok', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => ({ ok: true }),
        }));
        const t = makeTelegram(fetchImpl);
        await t.send({ text: 'hello' });
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://api.telegram.org/bottok_123/sendMessage',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.chat_id).toBe('chat_1');
        expect(body.text).toBe('hello');
    });

    it('throws on a non-ok HTTP response', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
        await expect(makeTelegram(fetchImpl).send({ text: 'x' })).rejects.toThrow(/429/);
    });

    it('throws when Telegram reports ok:false', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, description: 'chat not found' }) }));
        await expect(makeTelegram(fetchImpl).send({ text: 'x' })).rejects.toThrow(/chat not found/);
    });

    it('is disabled without token or chatId and send is a no-op', async () => {
        const t = new TelegramTransport({ token: null, chatId: 'c', fetchImpl: vi.fn() });
        expect(t.enabled).toBe(false);
        await expect(t.send({ text: 'x' })).resolves.toBeUndefined();
    });
});

describe('SmtpTransport (C7)', () => {
    it('passes config to the injected client and includes subject/text', async () => {
        const client = vi.fn(async () => {});
        const t = new SmtpTransport({
            host: 'smtp.example.com', port: 587, secure: false,
            user: 'u', pass: 'p', from: 'f@x.com', to: 't@x.com',
            client,
        });
        await t.send({ subject: 'S', text: 'T' });
        expect(client).toHaveBeenCalledWith(expect.objectContaining({
            host: 'smtp.example.com', port: 587, user: 'u', pass: 'p',
            from: 'f@x.com', to: 't@x.com', subject: 'S', text: 'T',
        }));
    });

    it('defaults from to the SMTP user', () => {
        const client = vi.fn(async () => {});
        const t = new SmtpTransport({ host: 'h', user: 'me', to: 'to@x.com', client });
        expect(t.opts.from).toBe('me');
    });

    it('is disabled without host/user/to', async () => {
        const client = vi.fn(async () => {});
        const t = new SmtpTransport({ host: 'h', client });
        expect(t.enabled).toBe(false);
        await expect(t.send({ subject: 's', text: 't' })).resolves.toBeUndefined();
        expect(client).not.toHaveBeenCalled();
    });
});
