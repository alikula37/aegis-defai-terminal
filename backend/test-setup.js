// Vitest per-worker database isolation.
//
// Every test worker gets its own throwaway SQLite file (AEGIS_DB_PATH) so
// suites that write to the DB (server, database, auth, stress) never contend
// with each other — a prune/reset in one file can no longer delete another
// file's simulation, and the real dev DB (backend/db/aegis.db) stays clean.
//
// Runs before the test file imports any module (setupFiles), so the env is
// in place before database.js is first loaded by the worker.

import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

process.env.AEGIS_DB_PATH = join(mkdtempSync(join(tmpdir(), 'aegis-test-')), 'test.db');
