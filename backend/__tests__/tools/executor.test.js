import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolExecutor } from '../../core/tools/executor.js';

const ctx = { marketData: { ethPrice: 3500, portfolio: { tvl: 100000, healthFactor: 2 } } };

describe('tool executor (B3-2)', () => {
    it('executes a valid tool call with defaults', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('get_market_snapshot', {}, ctx);
        expect(res.ok).toBe(true);
        expect(res.result.portfolio.tvl).toBe(100000);
        expect(ex.callsUsed).toBe(1);
        expect(ex.callsRemaining).toBe(5);
    });

    it('validates args before calling the handler', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('run_backtest', { leverage: 99 }, ctx);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('invalid_args');
        expect(res.detail[0].path).toBe('leverage');
        expect(ex.callsUsed).toBe(0);
    });

    it('rejects unknown tools', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('totally_fake', {}, ctx);
        expect(res.ok).toBe(false);
        expect(res.error).toContain('unknown_tool');
    });

    it('stops calling once the per-cycle budget is exhausted', async () => {
        const ex = new ToolExecutor({ maxCallsPerCycle: 2 });
        await ex.execute('get_market_snapshot', {}, ctx);
        await ex.execute('get_market_snapshot', {}, ctx);
        const res = await ex.execute('get_market_snapshot', {}, ctx);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('tool_call_budget_exhausted');
        expect(ex.callsUsed).toBe(2);
    });

    it('times out hung handlers', async () => {
        const hangingTools = new Map([
            ['get_market_snapshot', {
                name: 'get_market_snapshot',
                description: 'never settles',
                schema: z.object({}),
                handler: async () => new Promise(() => {}),
            }],
        ]);
        const ex = new ToolExecutor({ timeoutMs: 50, tools: hangingTools });
        const res = await ex.execute('get_market_snapshot', {}, ctx);
        expect(res.ok).toBe(false);
        expect(res.error).toContain('tool_timeout');
    });

    it('wraps handler errors without throwing', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('get_agent_logs', {}, {
            getLogs: async () => { throw new Error('db down'); },
        });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('tool_error');
    });

    it('returns structured errors for missing ctx services', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('get_recent_memories', {}, {});
        expect(res.ok).toBe(true);
        expect(res.result.error).toContain('not available');
    });

    it('records an audit trail for every call', async () => {
        const sink = [];
        const ex = new ToolExecutor({ auditSink: entry => sink.push(entry) });
        await ex.execute('get_market_snapshot', {}, ctx);
        await ex.execute('get_portfolio', {}, ctx);
        await ex.execute('nope', {}, ctx);

        const audit = ex.getAuditLog();
        expect(audit).toHaveLength(3);
        expect(audit[0]).toMatchObject({ name: 'get_market_snapshot', ok: true, args: {} });
        expect(audit[1]).toMatchObject({ name: 'get_portfolio', ok: true });
        expect(audit[2]).toMatchObject({ name: 'nope', ok: false });
        expect(typeof audit[0].durationMs).toBe('number');
        expect(audit[0].durationMs).toBeGreaterThanOrEqual(0);
        expect(sink).toHaveLength(3);
    });

    it('reset clears the budget and the audit trail', async () => {
        const ex = new ToolExecutor({ maxCallsPerCycle: 1 });
        await ex.execute('get_market_snapshot', {}, ctx);
        expect(ex.callsRemaining).toBe(0);
        ex.reset();
        expect(ex.callsRemaining).toBe(1);
        expect(ex.getAuditLog()).toEqual([]);
    });

    it('passes through params to handlers with context', async () => {
        const ex = new ToolExecutor();
        const res = await ex.execute('get_recent_memories', { limit: 3 }, {
            simulationId: 42,
            getRecentMemories: async (_limit, _simulationId) => [
                { id: 1, action_taken: 'hold', is_successful: 1, profit_loss: 0, market_state_json: null, created_at: 't' },
            ],
        });
        expect(res.ok).toBe(true);
        expect(res.result[0].id).toBe(1);
    });
});

describe('tool guardrails (B3-9)', () => {
    it('rejects write-like tool names the LLM might try to inject', async () => {
        const ex = new ToolExecutor();
        for (const name of ['exec', 'execute_trade', 'mint', 'transfer', 'send_transaction', 'flash_loan', 'repay', 'withdraw']) {
            const res = await ex.execute(name, {}, {});
            expect(res.ok).toBe(false);
            expect(res.error).toContain('unknown_tool');
        }
    });

    it('strips unknown/extra args from LLM-supplied tool calls (zod strip)', async () => {
        const ex = new ToolExecutor();
        let receivedArgs = null;
        const res = await ex.execute('run_backtest', { leverage: 4, attackerKey: 'pwned', target_ltv: 0.1 }, {
            backtester: { runBacktest: async args => { receivedArgs = args; return { strategy: 'loop', days: 90 }; } },
        });
        expect(res.ok).toBe(true);
        expect(receivedArgs).toEqual({ leverage: 4, rangeDays: 90 });
        expect(receivedArgs.attackerKey).toBeUndefined();
        expect(receivedArgs.target_ltv).toBeUndefined();
    });

    it('rejects malformed args payloads (arrays, strings, null)', async () => {
        const ex = new ToolExecutor();
        for (const bad of [[1, 2], 'string', null, 42]) {
            const res = await ex.execute('get_market_snapshot', bad, {});
            expect(res.ok).toBe(false);
            expect(res.error).toBe('invalid_args');
        }
    });

    it('never hands the LLM executable primitives — results are data only', async () => {
        // The tool result payload shape is { result } or { error } — the LLM
        // cannot request an execution; the agent's guardrail chain (validateLLMDecision)
        // is the only path to an action.
        const ex = new ToolExecutor();
        const res = await ex.execute('get_market_snapshot', {}, { marketData: { ethPrice: 1, portfolio: { tvl: 1 } } });
        expect(res.ok).toBe(true);
        expect(Object.keys(res)).toEqual(['ok', 'result']);
        expect(res.result).not.toHaveProperty('decision');
        expect(res.result).not.toHaveProperty('action');
    });
});
