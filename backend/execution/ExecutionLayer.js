// backend/execution/ExecutionLayer.js
// Chooses the concrete execution backend. The decision engine is agnostic to
// this choice — simulation and onchain backends share the same interface:
//   execute(response, marketData, conditions)

import { SimulationExecution } from './SimulationExecution.js';
import { OnchainExecution } from './OnchainExecution.js';

export const EXECUTION_MODES = {
    simulation: 'simulation',
    onchain: 'onchain',
};

export function createExecutionLayer(mode, ctx, options = {}) {
    if (mode === EXECUTION_MODES.onchain) {
        return new OnchainExecution({ ...ctx, ...options });
    }
    return new SimulationExecution(ctx);
}
