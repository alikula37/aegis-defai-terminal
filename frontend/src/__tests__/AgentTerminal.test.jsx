import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AgentTerminal from '../components/AgentTerminal';

const mockWs = { agentLogs: [], isConnected: true };

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => mockWs,
}));

vi.mock('../lib/apiClient', () => ({
    apiFetch: vi.fn(),
}));

import { apiFetch } from '../lib/apiClient';

const DECISION_LOG = {
    timestamp: '2026-08-14T10:00:00.000Z',
    type: 'decision',
    message: '🧠 hold: Scanning pools... No action required.',
    details: {
        reasoning: {
            situation: 'Market: ETH $2500, net APY 15.00%, safe zone.',
            analysis: "Decision 'hold' is driven by the current market state.",
            alternatives: ['hold — keep current position', 'adjust_portfolio — reduce LTV'],
            chosen: 'Conditions are stable. Health factor 1.50 is safe.',
        },
    },
};

const TOOL_LOG = {
    timestamp: '2026-08-14T10:00:01.000Z',
    type: 'tool',
    message: '[Tool] get_market_snapshot ok (12ms)',
};

const ALERT_LOG = {
    timestamp: '2026-08-14T10:00:02.000Z',
    type: 'alert',
    message: '⚠️ CRITICAL: Health Factor dropped below 1.15',
};

describe('AgentTerminal (B3-5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWs.agentLogs = [];
        mockWs.isConnected = true;
    });

    it('renders decision logs with a structured reasoning breakdown', async () => {
        mockWs.agentLogs = [DECISION_LOG];
        apiFetch.mockResolvedValue({ json: () => Promise.resolve([]) });
        render(<AgentTerminal />);

        const reasoning = await screen.findByText(/situation:/);
        expect(reasoning).toBeTruthy();
        expect(within(reasoning.parentElement).getByText(/Market: ETH \$2500/)).toBeTruthy();
        expect(screen.getByText(/analysis:/)).toBeTruthy();
        expect(screen.getByText(/chosen:/)).toBeTruthy();
        expect(screen.getByText(/hold — keep current position/)).toBeTruthy();
        expect(screen.getByText(/adjust_portfolio — reduce LTV/)).toBeTruthy();
    });

    it('shows tool audit entries so the data the LLM saw is visible', async () => {
        mockWs.agentLogs = [TOOL_LOG];
        apiFetch.mockResolvedValue({ json: () => Promise.resolve([]) });
        render(<AgentTerminal />);
        expect(screen.getByText(/\[Tool\] get_market_snapshot ok/)).toBeTruthy();
    });

    it('renders a decision without reasoning gracefully', async () => {
        mockWs.agentLogs = [{ ...DECISION_LOG, details: null }];
        apiFetch.mockResolvedValue({ json: () => Promise.resolve([]) });
        render(<AgentTerminal />);
        expect(screen.getByText(/🧠 hold/)).toBeTruthy();
    });

    it('parses metadata_json strings from REST logs', async () => {
        apiFetch.mockResolvedValue({
            json: () => Promise.resolve([{ ...DECISION_LOG, details: undefined, metadata_json: JSON.stringify({ reasoning: DECISION_LOG.details.reasoning }) }]),
        });
        render(<AgentTerminal />);
        expect(await screen.findByText(/situation:/)).toBeTruthy();
    });

    it('does not render non-allowed log types', async () => {
        mockWs.agentLogs = [ALERT_LOG, TOOL_LOG, DECISION_LOG];
        apiFetch.mockResolvedValue({ json: () => Promise.resolve([]) });
        render(<AgentTerminal />);
        expect(screen.queryByText(/⚠️ CRITICAL/)).toBeNull();
        expect(screen.getByText(/🧠 hold/)).toBeTruthy();
    });
});
