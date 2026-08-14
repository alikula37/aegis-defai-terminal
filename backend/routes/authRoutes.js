// backend/routes/authRoutes.js
// E9 — auth + admin user-management routes as a factory so isolated tests can
// exercise them without booting the HTTP server (no port, no EADDRINUSE).
// Mounted at /api in server.js; exempt from apiKeyMiddleware (login must never
// depend on an operator key that may still be unset).

import { Router } from 'express';
import {
    createUser, countUsers, getUserByUsername, getAllUsers, getUserById, deleteUserById,
    deleteSessionsByUser, getLocalUserId, getSessionUser,
} from '../db/database.js';
import {
    hashPassword, loginUser, logoutUser, getSessionToken,
    setSessionCookie, clearSessionCookie, closeUserSockets,
} from '../utils/auth.js';
import aegisConfig from '../aegis.config.js';

const USERNAME_RE = new RegExp(`^[a-zA-Z0-9_.-]{${aegisConfig.auth.usernameMin},${aegisConfig.auth.usernameMax}}$`);
const PASSWORD_MIN = aegisConfig.auth.passwordMin;
const PASSWORD_MAX = aegisConfig.auth.passwordMax;

function sanitizeUser(user) {
    return user ? { id: user.id, username: user.username, role: user.role } : null;
}

export function createAuthRouter({ clientsByUser, authRequired = true } = {}) {
    const router = Router();

    router.get('/auth/me', (req, res) => {
        // Self-contained: /api/auth/* is exempt from the session middleware
        // (login must work before a session exists), so /auth/me resolves the
        // session itself. 401 = logged out (drives the frontend redirect).
        if (authRequired) {
            const session = getSessionUser(getSessionToken(req));
            if (!session) return res.status(401).json({ error: 'Unauthorized: sign in required' });
            return res.json({ user: sanitizeUser(session), authRequired });
        }
        // Open mode — the seeded local user.
        const localId = getLocalUserId();
        return res.json({ user: { id: localId, username: 'local', role: 'admin' }, authRequired });
    });

    router.post('/auth/register', (req, res) => {
        try {
            const { username, password } = req.body || {};
            if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
                return res.status(400).json({ error: 'Username must be 3-32 chars (letters, digits, _ . -)' });
            }
            if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
                return res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} chars` });
            }
            if (getUserByUsername(username)) {
                return res.status(409).json({ error: 'Username already taken' });
            }
            // First registered account becomes admin (bootstrap); later ones are
            // regular users (an admin can create more via the admin API).
            const role = countUsers() === 0 ? 'admin' : 'user';
            const id = createUser(username, hashPassword(password), role);
            res.status(201).json({ user: { id, username, role } });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/auth/login', (req, res) => {
        try {
            const { username, password } = req.body || {};
            if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
                // Generic: never reveal whether the username exists.
                return res.status(401).json({ error: 'Invalid username or password' });
            }
            loginUser(username, password).then((result) => {
                if (!result.ok) {
                    return res.status(401).json({ error: 'Invalid username or password' });
                }
                setSessionCookie(res, result.token);
                res.json({ user: sanitizeUser(result.user) });
            }).catch((error) => {
                res.status(500).json({ error: error.message });
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/auth/logout', (req, res) => {
        // /api/auth/* is exempt from the session middleware, so resolve the
        // session here — logout must also close this user's live sockets.
        const token = getSessionToken(req);
        const session = getSessionUser(token);
        logoutUser(token);
        if (session?.id) closeUserSockets(session.id, clientsByUser);
        clearSessionCookie(res);
        res.json({ success: true });
    });

    // ---- Admin user management (role-gated, deny-by-default) ----

    router.get('/admin/users', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden: insufficient role' });
        res.json({ users: getAllUsers() });
    });

    router.post('/admin/users', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden: insufficient role' });
        try {
            const { username, password, role } = req.body || {};
            if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
                return res.status(400).json({ error: 'Username must be 3-32 chars (letters, digits, _ . -)' });
            }
            if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
                return res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} chars` });
            }
            if (role !== 'admin' && role !== 'user') {
                return res.status(400).json({ error: 'Role must be "admin" or "user"' });
            }
            if (getUserByUsername(username)) {
                return res.status(409).json({ error: 'Username already taken' });
            }
            const id = createUser(username, hashPassword(password), role);
            res.status(201).json({ user: { id, username, role } });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/admin/users/:id', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden: insufficient role' });
        try {
            const id = parseInt(req.params.id);
            const target = getUserById(id);
            if (!target) return res.status(404).json({ error: 'User not found' });
            if (target.id === req.user.id) {
                return res.status(400).json({ error: 'You cannot delete your own account' });
            }
            if (target.username === 'local') {
                return res.status(400).json({ error: 'The local user cannot be deleted' });
            }
            // Revoke every session + close live sockets immediately.
            deleteSessionsByUser(id);
            closeUserSockets(id, clientsByUser);
            deleteUserById(id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

export { sanitizeUser };