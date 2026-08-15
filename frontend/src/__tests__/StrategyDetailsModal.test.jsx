import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StrategyDetailsModal from '../components/StrategyDetailsModal';
import { deriveStrategyBreakdown, deriveAgentTimeline } from '../components/strategyDetailsLogic';
vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = { t: (k) => en[k] ?? k, lang: 'en', setLang: () => {} };
    return { useI18n: () => api };
});

const mockWs = { portfolioData: null, agentLogs: [] };
vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => mockWs,
}));

const strategy = {
    name: 'Ethena sUSDe Leverage',
    protocol: 'Ethena + Morpho',
    apy: 28.4,
    tvl: 50000,
    borrowProtocol: 'Morpho Blue',
};

describe('deriveStrategyBreakdown', () => {
    it('uses live supply and borrow APYs with live net', () => {
        const portfolio = {
            susdeApy: 4.5,
            morphoBorrowApy: 6.4,
            aaveV4BorrowApy: 7.0,
            netApy: 2.1,
            points: { totalPointsApy: 0.8 },
        };
        const b = deriveStrategyBreakdown(strategy, portfolio);
        expect(b.baseYield).toBe(4.5);
        expect(b.borrowApy).toBe(6.4);
        expect(b.netApy).toBe(2.1);
        expect(b.pointsApy).toBe(0.8);
    });

    it('uses Aave borrow rate when strategy borrows from Aave', () => {
        const portfolio = { susdeApy: 4.5, morphoBorrowApy: 6.4, aaveV4BorrowApy: 7.0, netApy: 0 };
        const b = deriveStrategyBreakdown({ ...strategy, borrowProtocol: 'Aave V4 E-Mode' }, portfolio);
        expect(b.borrowApy).toBe(7.0);
    });

    it('uses catalog APY for RWA strategies (no live oracle yet)', () => {
        const portfolio = { susdeApy: 4.5, morphoBorrowApy: 6.4, netApy: 0 };
        const b = deriveStrategyBreakdown({ name: 'PT-syrupUSDC RWA', apy: 12.8 }, portfolio);
        expect(b.baseYield).toBe(12.8);
    });

    it('honors a live net of 0 as a real value', () => {
        const portfolio = { susdeApy: 5, morphoBorrowApy: 3, netApy: 0, points: { totalPointsApy: 1 } };
        const b = deriveStrategyBreakdown(strategy, portfolio);
        expect(b.netApy).toBe(0);
    });

    it('computes net from components when live net is undefined', () => {
        const portfolio = { susdeApy: 5, morphoBorrowApy: 3, points: { totalPointsApy: 1 } };
        const b = deriveStrategyBreakdown(strategy, portfolio);
        expect(b.netApy).toBe(3);
    });

    it('handles missing portfolio without producing NaN', () => {
        const b = deriveStrategyBreakdown(strategy, null);
        expect(Number.isNaN(b.netApy)).toBe(false);
        expect(Number.isNaN(b.baseYield)).toBe(false);
        expect(b.baseYield).toBe(0);
    });
});

describe('deriveAgentTimeline', () => {
    it('returns empty for no logs', () => {
        expect(deriveAgentTimeline([])).toHaveLength(0);
        expect(deriveAgentTimeline(undefined)).toHaveLength(0);
    });

    it('maps log types to labels and caps at 6', () => {
        const logs = Array.from({ length: 8 }, (_, i) => ({ timestamp: `2026-08-13T${i}:00:00Z`, type: i % 2 ? 'claim' : 'alert', message: `msg ${i}` }));
        const timeline = deriveAgentTimeline(logs);
        expect(timeline).toHaveLength(6);
        expect(timeline[0].title).toBe('Alert'.replace('Alert', 'Guardrail Alert'));
    });
});

describe('StrategyDetailsModal component', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<StrategyDetailsModal isOpen={false} onClose={() => { }} strategy={strategy} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders live breakdown and real timeline from WebSocket data', () => {
        mockWs.portfolioData = {
            tvl: 50000,
            susdeApy: 4.5,
            morphoBorrowApy: 6.4,
            netApy: 2.1,
            points: { totalPointsApy: 0.8 },
            oracleStatus: 'LIVE',
        };
        mockWs.agentLogs = [
            { timestamp: '2026-08-13T12:00:00Z', type: 'claim', message: 'Rewards claimed: 12.5 sUSDe' },
            { timestamp: '2026-08-13T11:00:00Z', type: 'scan', message: 'Market scan complete' },
        ];
        render(<StrategyDetailsModal isOpen onClose={() => { }} strategy={strategy} />);

        expect(screen.getAllByText('+2.10%').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('Rewards claimed: 12.5 sUSDe')).toBeInTheDocument();
        expect(screen.getByText('Market scan complete')).toBeInTheDocument();
        expect(screen.getByText('LIVE')).toBeInTheDocument();
    });

    it('shows empty state when no agent logs exist', () => {
        mockWs.portfolioData = { tvl: 100, susdeApy: 4.5, morphoBorrowApy: 6.4, netApy: 0, points: {} };
        mockWs.agentLogs = [];
        render(<StrategyDetailsModal isOpen onClose={() => { }} strategy={strategy} />);
        expect(screen.getByText(/No agent activity recorded yet/i)).toBeInTheDocument();
    });
});
