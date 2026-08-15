// backend/utils/rateLimit.js
// Rate-limit factory. Extracted from server.js so isolated tests can exercise
// limiters without booting the HTTP server (avoiding port collisions).
//
// Behind the nginx reverse proxy every request arrives from the proxy's IP,
// so the caller must `app.set('trust proxy', 1)` for req.ip to be the real
// client (X-Forwarded-For). Without it, all users share one bucket and a
// single active browser can starve everyone else.

import rateLimit from 'express-rate-limit';

export function createRateLimiter({
    windowMs = 15 * 60 * 1000,
    max = 100,
    // Skip requests that already carry an authenticated session (req.user) —
    // polling of a logged-in user is legitimate traffic, rate limiting is
    // for anonymous abuse.
    skipAuthenticated = false,
} = {}) {
    // The returned instance also exposes resetKey(key) — callers clear an IP
    // bucket on success (e.g. a successful login), so a brute-force burst
    // never locks the legitimate user out for the whole window.
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        ...(skipAuthenticated ? { skip: (req) => !!req.user } : {}),
    });
}

/**
 * Failure-only limiter (credential endpoints): counts only FAILED attempts per
 * client IP. Successful requests never consume budget and reset the bucket.
 * express-rate-limit cannot express this — its check happens before the
 * handler runs, so a full bucket blocks successful logins too (and its
 * skipSuccessfulRequests option does not change the blocking decision).
 */
export function createFailureLimiter({ windowMs = 15 * 60 * 1000, max = 50 } = {}) {
    const counters = new Map(); // ip -> { count, resetAt }
    return (req, res, next) => {
        const key = req.ip;
        const now = Date.now();
        const current = counters.get(key);
        if (current && current.resetAt <= now) {
            counters.delete(key);
        }
        const active = counters.get(key);
        if (active && active.count >= max) {
            return res.status(429).json({ error: 'Too many requests, please try again later.' });
        }
        res.on('finish', () => {
            if (res.statusCode >= 400) {
                const entry = counters.get(key);
                if (entry && entry.resetAt <= Date.now()) {
                    counters.delete(key);
                }
                const target = counters.get(key) ?? { count: 0, resetAt: Date.now() + windowMs };
                target.count += 1;
                counters.set(key, target);
            } else {
                // Any success (login, register, logout) clears the bucket —
                // the legitimate user is never locked out by prior failures.
                counters.delete(key);
            }
        });
        next();
    };
}
