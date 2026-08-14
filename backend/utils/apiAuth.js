// backend/utils/apiAuth.js
// REST API key middleware. Extracted from server.js so isolated tests can
// exercise it without booting the HTTP server (avoiding port collisions).

// In production, an unset AEGIS_API_KEY fails closed: state-changing endpoints
// are rejected (the agent can never be driven unauthenticated); reads stay
// open so health/status/overview keep working.
export function createApiKeyMiddleware(env = process.env) {
    return (req, res, next) => {
        const expected = env.AEGIS_API_KEY;
        const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
        if (expected) {
            if (req.headers['x-api-key'] === expected) return next();
            return res.status(401).json({ error: 'Unauthorized: missing or invalid x-api-key' });
        }
        if (env.NODE_ENV === 'production') {
            if (isWrite) {
                return res.status(401).json({ error: 'Unauthorized: AEGIS_API_KEY is not configured on the server (production)' });
            }
        }
        return next();
    };
}

export const apiKeyMiddleware = createApiKeyMiddleware();
