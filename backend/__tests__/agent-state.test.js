import { describe, it, expect } from 'vitest';
import { simulationState, resetAgentState } from '../core/agentState.js';

describe('agentState', () => {
    it('exposes the default strategy state', () => {
        expect(simulationState.currentBorrowChain).toBe('Ethereum');
        expect(simulationState.currentBorrowProtocol).toBe('Morpho Blue');
        expect(simulationState.currentLtv).toBe(0.8);
        expect(simulationState.currentCollateral).toBe('PT-sUSDe');
        expect(simulationState.allocations).toEqual({ loop: 1, basis: 0, jit: 0 });
    });

    it('resets mutated state back to defaults', () => {
        simulationState.currentBorrowChain = 'Base';
        simulationState.currentBorrowProtocol = 'Aave V4 E-Mode';
        simulationState.currentLtv = 0;
        simulationState.currentCollateral = 'sUSDe';
        simulationState.allocations = { loop: 0.5, basis: 0.3, jit: 0.2 };

        resetAgentState();

        expect(simulationState.currentBorrowChain).toBe('Ethereum');
        expect(simulationState.currentBorrowProtocol).toBe('Morpho Blue');
        expect(simulationState.currentLtv).toBe(0.8);
        expect(simulationState.currentCollateral).toBe('PT-sUSDe');
        expect(simulationState.allocations).toEqual({ loop: 1, basis: 0, jit: 0 });
    });
});
