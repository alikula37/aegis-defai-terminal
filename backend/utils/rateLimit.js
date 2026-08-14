// backend/utils/rateLimit.js
// Rate-limit factory. Extracted from server.js so isolated tests can exercise
// limiters without booting the HTTP server (avoiding port collisions).

import rateLimit from 'express-rate-limit';

export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100 } = {}) {
    return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false });
}
