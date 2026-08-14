// backend/utils/auth.js
// E9 — server-side session auth (research-backed: OWASP Session Management /
// Authentication / Password Storage cheat sheets, Copenhagen Book).
//
// Model:
//   - Session id in an HttpOnly; SameSite=Lax; Secure(in prod) cookie.
//     Stored server-side hashed (sha256) in the SQLite `sessions` table —
//     revocation/logout = delete the row, no JWT denylist machinery.
//   - Passwords: crypto.scrypt N=2^17, r=8, p=1 (OWASP minimum bar, zero deps),
//     parameters encoded in the stored hash for future upgrades.
//   - Brute force: per-account lockout (5 fails → 15 min) + generic error
//     messages + dummy-hash verify for unknown users (timing equalization).
//   - CSRF: SameSite=Lax + server-side Origin check on state-changing requests
//     (no synchronizer-token machinery — see docs/AUTH.md).
//   - AUTH_REQUIRED=false (default dev / open mode) → every request acts as
//     the seeded 'local' user, preserving the pre-E9 single-user behavior.

import crypto from 'crypto';
import logger from './logger.js';
import {
    getLocalUserId, getSessionUser, createSession, deleteSession, deleteSessionsByUser,
    getUserById, getUserByUsername, incrementFailedAttempts, clearFailedAttempts,
} from '../db/database.js';

export const SESSION_COOKIE = 'aegis_session';
const SCRYPT_N = 131072; // 2^17
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_LEN = 16;
// N=2^17 × r=8 × 128B = 128 MiB working memory → raise Node's default maxmem.
const SCRYPT_OPTS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 };

export function isAuthRequired(env = process.env) {
    if (env.AUTH_REQUIRED === 'true') return true;
    if (env.AUTH_REQUIRED === 'false') return false;
    // Default: required in production, open in dev (single-user mode).
    return env.NODE_ENV === 'production';
}

// ---- password hashing (scrypt, OWASP minimums) ----

export function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
    if (!stored) return false;
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltHex, hashHex] = parts;
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, {
        N: Number(n), r: Number(r), p: Number(p),
        // N=2^17,r=8 needs 128MB; Node's default maxmem (32MB) would reject it.
        maxmem: 256 * 1024 * 1024,
    });
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// A valid hash of a random password: unknown usernames run the same scrypt
// work so response timing does not leak whether an account exists (OWASP).
const DUMMY_HASH = hashPassword('aegis-timing-equalizer');

// ---- cookie helpers ----

export function sessionCookieOptions(env = process.env) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        path: '/',
        maxAge: (Number(env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000,
    };
}

export function getSessionToken(req) {
    const header = req.headers?.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === SESSION_COOKIE) return rest.join('=');
    }
    return null;
}

export function setSessionCookie(res, token, env = process.env) {
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(env));
}

export function clearSessionCookie(res, env = process.env) {
    const opts = sessionCookieOptions(env);
    res.clearCookie(SESSION_COOKIE, { ...opts, maxAge: 0 });
}

// ---- auth lifecycle helpers (used by the /api/auth routes) ----

export async function loginUser(username, password) {
    // Generic failure — never distinguish "unknown user" from "wrong password".
    const user = getUserByUsername(username);
    const hash = user?.password_hash ?? DUMMY_HASH;
    const ok = verifyPassword(password, hash);
    if (!user) return { ok: false };
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return { ok: false, locked: true };
    }
    if (!ok) {
        incrementFailedAttempts(user.id);
        return { ok: false };
    }
    clearFailedAttempts(user.id);
    const { token } = createSession(user.id);
    return { ok: true, token, user: { id: user.id, username: user.username, role: user.role } };
}

export function logoutUser(token) {
    deleteSession(token);
}

// ---- middleware (attach to /api) ----

/**
 * Attaches req.user. Open mode → the seeded local user (pre-E9 behavior).
 * Required mode → the session owner, else 401. Deny-by-default: any /api
 * route that needs identity always has it; routes that don't call
 * requireRole stay as-is.
 */
export function createAuthMiddleware({ authRequired = isAuthRequired() } = {}) {
    if (!authRequired) {
        const localId = getLocalUserId();
        return (req, _res, next) => {
            req.user = { id: localId, username: 'local', role: 'admin' };
            next();
        };
    }
    return (req, res, next) => {
        const token = getSessionToken(req);
        const session = getSessionUser(token);
        if (!session) {
            return res.status(401).json({ error: 'Unauthorized: sign in required' });
        }
        req.user = session;
        req.sessionToken = token;
        next();
    };
}

export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: insufficient role' });
        }
        next();
    };
}

/**
 * CSRF/CSWSH defense for state-changing requests (OWASP "custom header / Origin
 * check" pattern — no token machinery). Requests without an Origin header
 * (curl, same-origin non-browser) pass; cross-origin browsers are rejected
 * unless the Origin is in the CORS allowlist.
 */
export function createOriginCheck({ allowedOrigins = ['http://localhost:5173'] } = {}) {
    const allowed = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : allowedOrigins;
    return (req, res, next) => {
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
            const origin = req.headers.origin;
            if (origin && !allowed.includes(origin) && !allowed.includes('*')) {
                logger.warn(`[SECURITY] Origin check rejected ${req.method} ${req.url} from ${origin}`);
                return res.status(403).json({ error: 'Forbidden: cross-origin request rejected' });
            }
        }
        next();
    };
}

// ---- admin helpers ----

export function closeUserSockets(userId, socketsByUser) {
    const userSockets = socketsByUser?.get?.(userId);
    if (!userSockets) return;
    for (const ws of [...userSockets]) {
        try { ws.close(4001, 'Session ended'); } catch (_) { /* ignore */ }
    }
}

export { deleteSessionsByUser, getUserById, getSessionUser, logger };
