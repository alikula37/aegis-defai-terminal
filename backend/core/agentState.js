// backend/core/agentState.js
// Shared mutable strategy state for the agent. Kept as a singleton module so
// both the decision layer and the simulation execution backend mutate the
// same object (mirrors the pre-refactor module-level state in agent.js).

export const simulationState = {
    currentBorrowChain: 'Ethereum',
    currentBorrowProtocol: 'Morpho Blue',
    currentLtv: 0.80,
    currentCollateral: 'PT-sUSDe',
    allocations: {
        loop: 1.0,
        basis: 0.0,
        jit: 0.0
    }
};

export function resetAgentState() {
    simulationState.currentBorrowChain = 'Ethereum';
    simulationState.currentBorrowProtocol = 'Morpho Blue';
    simulationState.currentLtv = 0.80;
    simulationState.currentCollateral = 'PT-sUSDe';
    simulationState.allocations = { loop: 1.0, basis: 0.0, jit: 0.0 };
}
