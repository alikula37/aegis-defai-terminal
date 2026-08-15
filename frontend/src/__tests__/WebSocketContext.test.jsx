import { describe, it, expect, vi } from 'vitest';
import { applyWsMessage } from '../contexts/WebSocketContext';

function setters() {
    return {
        setPortfolioData: vi.fn(),
        setAgentLogs: vi.fn(),
        setIsSimulationRunning: vi.fn(),
        setSimulationStartTime: vi.fn(),
        setSimulationName: vi.fn(),
        setExecutionStatus: vi.fn(),
        setNotifications: vi.fn(),
    };
}

describe('applyWsMessage — sharp simulation separation', () => {
    it('portfolio_update fills the data', () => {
        const s = setters();
        applyWsMessage({ type: 'portfolio_update', payload: { tvl: 100 } }, s);
        expect(s.setPortfolioData).toHaveBeenCalledWith(expect.objectContaining({ tvl: 100 }));
    });

    it('simulation_status running clears nothing', () => {
        const s = setters();
        applyWsMessage({ type: 'simulation_status', payload: { isRunning: true, startTime: 1 } }, s);
        expect(s.setIsSimulationRunning).toHaveBeenCalledWith(true);
        expect(s.setPortfolioData).not.toHaveBeenCalled();
        expect(s.setAgentLogs).not.toHaveBeenCalled();
    });

    it('simulation_status stopped clears portfolio, logs and hasData', () => {
        const s = setters();
        s.setHasData = vi.fn();
        applyWsMessage({ type: 'simulation_status', payload: { isRunning: false, startTime: null } }, { ...s, setHasData: s.setHasData });
        expect(s.setIsSimulationRunning).toHaveBeenCalledWith(false);
        expect(s.setPortfolioData).toHaveBeenCalledWith(null);
        expect(s.setAgentLogs).toHaveBeenCalledWith([]);
        expect(s.setHasData).toHaveBeenCalledWith(false);
    });

    it('keeps the simulation name when the stop payload carries one', () => {
        const s = setters();
        applyWsMessage({ type: 'simulation_status', payload: { isRunning: false, startTime: null, simulationName: 'sim_abc' } }, { ...s, setHasData: vi.fn() });
        expect(s.setSimulationName).toHaveBeenCalledWith('sim_abc');
    });
});
