import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RiskAlerts from '../components/RiskAlerts';
import { deriveRiskAlerts } from '../components/riskAlertsLogic';
vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    // Mirrors the real t(): key lookup + {var} interpolation.
    const api = {
        t: (k, vars) => {
            const msg = en[k] ?? k;
            if (!vars) return msg;
            return String(msg).replace(/\{(\w+)\}/g, (m, name) =>
                vars[name] !== undefined ? String(vars[name]) : m,
            );
        },
        lang: 'en',
        setLang: () => {},
    };
    return { useI18n: () => api };
});

const mockWs = { portfolioData: null };
const mockSettings = { targetHf: 1.25, maxGasClaim: 20 };

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => mockWs,
}));
vi.mock('../contexts/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings }),
}));

describe('deriveRiskAlerts', () => {
    it('returns a neutral alert when there is no portfolio data', () => {
        const alerts = deriveRiskAlerts(null, mockSettings);
        expect(alerts).toHaveLength(1);
        expect(alerts[0].type).toBe('neutral');
        expect(alerts[0].titleKey).toBe('riskAlert.awaitingTitle');
    });

    it('flags SIM mode as a neutral informational alert', () => {
        const alerts = deriveRiskAlerts({ oracleStatus: 'SIM (depeg)', baseSpread: 1 }, mockSettings);
        expect(alerts.some(a => a.type === 'neutral' && a.titleKey === 'riskAlert.simTitle')).toBe(true);
    });

    it('flags low health factor as danger', () => {
        const alerts = deriveRiskAlerts({ oracleStatus: 'LIVE', healthFactor: 1.1, baseSpread: 2, gasPrice: 5 }, mockSettings);
        const danger = alerts.find(a => a.type === 'danger');
        expect(danger).toBeTruthy();
        expect(danger.titleKey).toBe('riskAlert.hfTitle');
        expect(danger.titleVars).toEqual({ hf: '1.10', targetHf: '1.25' });
    });

    it('flags negative spread as danger', () => {
        const alerts = deriveRiskAlerts({ oracleStatus: 'LIVE', healthFactor: 1.8, baseSpread: -2.5, gasPrice: 5 }, mockSettings);
        const danger = alerts.find(a => a.type === 'danger');
        expect(danger).toBeTruthy();
        expect(danger.titleKey).toBe('riskAlert.spreadNegTitle');
        expect(danger.titleVars).toEqual({ spread: '-2.50' });
    });

    it('shows success when spread is positive and health is fine', () => {
        const alerts = deriveRiskAlerts({ oracleStatus: 'LIVE', healthFactor: 1.8, baseSpread: 2.2, gasPrice: 5 }, mockSettings);
        expect(alerts.some(a => a.type === 'success' && a.titleKey === 'riskAlert.spreadPosTitle')).toBe(true);
        expect(alerts.some(a => a.type === 'danger')).toBe(false);
    });

    it('warns when gas price exceeds claim threshold', () => {
        const alerts = deriveRiskAlerts({ oracleStatus: 'LIVE', healthFactor: 1.8, baseSpread: 2, gasPrice: 40 }, mockSettings);
        const warning = alerts.find(a => a.type === 'warning');
        expect(warning).toBeTruthy();
        expect(warning.titleKey).toBe('riskAlert.gasTitle');
        expect(warning.titleVars).toEqual({ gas: '40.00' });
    });
});

describe('RiskAlerts component', () => {
    beforeEach(() => {
        mockWs.portfolioData = null;
    });

    it('renders the awaiting-data state when disconnected', () => {
        render(<RiskAlerts />);
        expect(screen.getByText(/Awaiting market data/i)).toBeInTheDocument();
    });

    it('renders live alerts from portfolio data', () => {
        mockWs.portfolioData = { oracleStatus: 'LIVE', healthFactor: 1.1, baseSpread: -1.5, gasPrice: 30 };
        render(<RiskAlerts />);
        expect(screen.getByText(/Health Factor 1.10 below target 1.25/i)).toBeInTheDocument();
        expect(screen.getByText(/Negative yield spread \(-1.50%\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Gas price high \(30.00 gwei\)/i)).toBeInTheDocument();
    });
});
