import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RiskAlerts from '../components/RiskAlerts';
import PointsTracker from '../components/PointsTracker';
import GlossaryTooltip from '../components/GlossaryTooltip';

vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
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

const state = { portfolioData: null, settings: { targetHf: 1.25, maxGasClaim: 20 } };

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({ portfolioData: state.portfolioData }),
}));
vi.mock('../contexts/SettingsContext', () => ({
    useSettings: () => ({ settings: state.settings }),
}));

// Render-tree snapshots: catch unexpected hierarchy changes (an accidental
// wrapper, a dropped section, a class rename) across refactors.

describe('render tree snapshots', () => {
    beforeEach(() => {
        state.portfolioData = null;
    });

    it('RiskAlerts — awaiting-data state', () => {
        const { container } = render(<RiskAlerts />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('RiskAlerts — nominal state (no alerts fired)', () => {
        state.portfolioData = { oracleStatus: 'LIVE', healthFactor: 1.8, baseSpread: 2, gasPrice: 5 };
        const { container } = render(<RiskAlerts />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('RiskAlerts — danger state (low HF, negative spread, high gas)', () => {
        state.portfolioData = { oracleStatus: 'LIVE', healthFactor: 1.05, baseSpread: -1.5, gasPrice: 40 };
        const { container } = render(<RiskAlerts />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('PointsTracker — awaiting-data state', () => {
        const { container } = render(<PointsTracker />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('PointsTracker — populated points', () => {
        state.portfolioData = {
            points: {
                morphoPointsApy: 1.0,
                enaPointsApy: 2.0,
                borosFundingYield: 0.8,
                corkHedgeCost: -0.15,
                totalPointsApy: 2.9,
            },
        };
        const { container } = render(<PointsTracker />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('GlossaryTooltip — closed popover (help button only)', () => {
        const { container } = render(<GlossaryTooltip term="glossary.hf" />);
        expect(container.firstChild).toMatchSnapshot();
    });

    it('GlossaryTooltip — open popover shows title + description', async () => {
        const { container } = render(<GlossaryTooltip term="glossary.hf" />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        expect(container.firstChild).toMatchSnapshot();
        // Escape closes it again.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
});