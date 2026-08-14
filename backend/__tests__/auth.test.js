import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthMiddleware, createOriginCheck, hashPassword } from '../utils/auth.js';
import { createAuthRouter } from '../routes/authRoutes.js';
import {
    createUser, getUserById, getLocalUserId, closeDatabase,
} from '../db/database.js';

const adminU = `auth_admin_${Date.now()}`;
const userU = `auth_user_${Date.now()}`;
let adminId;
let userAgent; // supertest agent with cookies
let adminAgent;

function buildApp({ authRequired = true } = {}) {
    const app = express();
    app.use(express.json());
    app.use(createOriginCheck({ allowedOrigins: ['http://localhost:5173'] }));
    app.use('/api/', (req, res, next) => {
        if (req.path.startsWith('/auth/')) return next();
        return createAuthMiddleware({ authRequired })(req, res, next);
    });
    app.use('/api', createAuthRouter({ clientsByUser: new Map(), authRequired }));
    return app;
}

describe('E9 auth (required mode)', () => {
    beforeAll(async () => {
        adminId = createUser(adminU, hashPassword('Adminpass123'), 'admin');
        createUser(userU, hashPassword('Userpass123'), 'user');
        adminAgent = request.agent(buildApp());
        userAgent = request.agent(buildApp());
        await adminAgent.post('/api/auth/login').send({ username: adminU, password: 'Adminpass123' });
        await userAgent.post('/api/auth/login').send({ username: userU, password: 'Userpass123' });
    });

    afterAll(() => {
        closeDatabase();
    });

    it('rejects unauthenticated /api/auth/me with 401', async () => {
        const res = await request(buildApp()).get('/api/auth/me');
        expect(res.status).toBe(401);
    });

    it('login sets an HttpOnly SameSite=Lax cookie and me() returns the user', async () => {
        const res = await request(buildApp()).post('/api/auth/login')
            .send({ username: userU, password: 'Userpass123' });
        expect(res.status).toBe(200);
        const cookie = res.headers['set-cookie']?.[0] || '';
        expect(cookie).toContain('aegis_session=');
        expect(cookie).toContain('HttpOnly');
        expect(cookie.toLowerCase()).toContain('samesite=lax');
        expect(res.body.user.username).toBe(userU);

        const me = await request(buildApp()).get('/api/auth/me')
            .set('Cookie', cookie.split(';')[0]);
        expect(me.status).toBe(200);
        expect(me.body.user.username).toBe(userU);
        expect(me.body.authRequired).toBe(true);
    });

    it('returns a generic error for both unknown user and wrong password', async () => {
        const unknown = await request(buildApp()).post('/api/auth/login')
            .send({ username: 'nobody_here', password: 'Whatever123' });
        const wrong = await request(buildApp()).post('/api/auth/login')
            .send({ username: userU, password: 'Wrongpass123' });
        expect(unknown.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(unknown.body.error).toBe(wrong.body.error);
    });

    it('locks the account after 5 failures and rejects even a correct password', async () => {
        const victim = `locky_${Date.now()}`;
        const uid = createUser(victim, hashPassword('Goodpass123'), 'user');
        const app = buildApp();
        for (let i = 0; i < 5; i++) {
            await request(app).post('/api/auth/login').send({ username: victim, password: 'Badpass123' });
        }
        // correct password, but locked — generic message (no existence leak)
        const res = await request(app).post('/api/auth/login').send({ username: victim, password: 'Goodpass123' });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid username or password');
        // lockout state lives in the DB (account-scoped, OWASP)
        const locked = getUserById(uid);
        expect(Number(locked.failed_attempts)).toBe(5);
        expect(locked.locked_until).not.toBeNull();
    });

    it('registers users and prevents duplicates', async () => {
        const app = buildApp();
        const fresh = `fresh_${Date.now()}`;
        const ok = await request(app).post('/api/auth/register').send({ username: fresh, password: 'Freshpass123' });
        expect(ok.status).toBe(201);
        expect(ok.body.user.role).toBe('user'); // users already exist → user
        const dup = await request(app).post('/api/auth/register').send({ username: fresh, password: 'Freshpass123' });
        expect(dup.status).toBe(409);
        const bad = await request(app).post('/api/auth/register').send({ username: 'x', password: 'short' });
        expect(bad.status).toBe(400);
    });

    it('logout invalidates the session', async () => {
        const app = buildApp();
        const agent = request.agent(app);
        await agent.post('/api/auth/login').send({ username: userU, password: 'Userpass123' });
        const logout = await agent.post('/api/auth/logout');
        expect(logout.status).toBe(200);
        const me = await agent.get('/api/auth/me');
        expect(me.status).toBe(401);
    });

    it('denies admin endpoints to regular users (403) and to guests (401)', async () => {
        const users = await userAgent.get('/api/admin/users');
        expect(users.status).toBe(403);
        const guests = await request(buildApp()).get('/api/admin/users');
        expect(guests.status).toBe(401);
    });

    it('lets admins list, create and delete users', async () => {
        const list = await adminAgent.get('/api/admin/users');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.users)).toBe(true);

        const created = await adminAgent.post('/api/admin/users')
            .send({ username: `managed_${Date.now()}`, password: 'Managed123', role: 'user' });
        expect(created.status).toBe(201);
        expect(created.body.user.role).toBe('user');

        const deleted = await adminAgent.delete(`/api/admin/users/${created.body.user.id}`);
        expect(deleted.status).toBe(200);
        const gone = await adminAgent.get('/api/admin/users');
        expect(gone.body.users.some(u => u.id === created.body.user.id)).toBe(false);
    });

    it('refuses to delete self or the local user', async () => {
        const self = await adminAgent.delete(`/api/admin/users/${adminId}`);
        expect(self.status).toBe(400);
        const local = await adminAgent.delete(`/api/admin/users/${getLocalUserId()}`);
        expect(local.status).toBe(400);
    });

    it('rejects cross-origin state-changing requests (CSRF Origin check)', async () => {
        const app = buildApp();
        const evil = await request(app).post('/api/auth/login')
            .set('Origin', 'https://evil.example')
            .send({ username: userU, password: 'Userpass123' });
        expect(evil.status).toBe(403);
        // Same-origin / absent Origin passes
        const ok = await request(app).post('/api/auth/login')
            .set('Origin', 'http://localhost:5173')
            .send({ username: userU, password: 'Userpass123' });
        expect(ok.status).toBe(200);
    });

    // ---- Data-detailed: credential boundary table ----
    // Valid rows get a uniqueness suffix appended (staying within 32 chars);
    // invalid rows fail validation BEFORE uniqueness is checked, so they are
    // used as-is. 'a'*25 + '_' + 6 digits = exactly 32 chars (max length).
    it.each([
        // [username, password, expectedStatus]
        ['ab', 'Password1', 400],              // username too short (min 3)
        ['abc', 'Password1', 201],             // username at min length
        ['a'.repeat(25), 'Password1', 201],    // username at max length (32)
        ['a'.repeat(33), 'Password1', 400],    // username too long
        ['valid_user.name-1', 'Password1', 201], // allowed charset
        ['türkçe', 'Password1', 400],          // non-ASCII username
        ['has space', 'Password1', 400],       // space in username
        ['abc', 'Passwor', 400],               // password too short (min 8)
        ['abc', 'Password', 201],              // password at min length
        ['abc', 'p'.repeat(128), 201],         // password at max length
        ['abc', 'p'.repeat(129), 400],         // password too long
    ])('register(%j, pass-len=%s) → %s', async (username, password, expectedStatus) => {
        const app = buildApp();
        const finalUsername = expectedStatus === 201
            ? `${username}_${Date.now() % 100000}`
            : username;
        const res = await request(app).post('/api/auth/register')
            .send({ username: finalUsername, password });
        expect(res.status).toBe(expectedStatus);
        if (expectedStatus === 201) {
            expect(res.body.user.role).toBe('user');
        }
    });

    // ---- Data-detailed: login input matrix ----
    it.each([
        [{}, 401],
        [{ username: userU }, 401],
        [{ password: 'Userpass123' }, 401],
        [{ username: '', password: '' }, 401],
        [{ username: '   ', password: 'Userpass123' }, 401],
    ])('login(%j) → 401 generic', async (payload, expected) => {
        const res = await request(buildApp()).post('/api/auth/login').send(payload);
        expect(res.status).toBe(expected);
        expect(res.body.error).toBe('Invalid username or password');
    });

    it('open mode attaches the local user without a session', async () => {
        const app = buildApp({ authRequired: false });
        const me = await request(app).get('/api/auth/me');
        expect(me.status).toBe(200);
        expect(me.body.user.username).toBe('local');
        expect(me.body.authRequired).toBe(false);
    });

    it('first real registration becomes admin (local seed excluded) — runs last', async () => {
        // Simulate a fresh install: wipe every real user except the seeded
        // 'local', then register — the account must get role 'admin'. Must run
        // after the fixture-dependent tests, so it is declared last.
        const { getAllUsers, deleteUserById } = await import('../db/database.js');
        for (const u of getAllUsers()) deleteUserById(u.id);
        const app = buildApp();
        const first = `first_${Date.now()}`;
        const res = await request(app).post('/api/auth/register').send({ username: first, password: 'FirstPass123' });
        expect(res.status).toBe(201);
        expect(res.body.user.role).toBe('admin');
    });
// scrypt (N=2^17) is deliberately expensive; under parallel CI load a
// login+verify can take several seconds, so the suite gets a 30s budget.
}, 30000);
