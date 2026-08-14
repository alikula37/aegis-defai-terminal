import config from '../../aegis.config.js';
import { getSettings } from '../../db/database.js';
import { LiveDataSource } from './LiveDataSource.js';
import { SimDataSource } from './SimDataSource.js';

export { invalidateRpcProvider } from './LiveDataSource.js';

const DEFAULT_MODE = config.marketData.mode || 'LIVE';

/**
 * Facade over the data sources. Chooses the implementation based on the
 * configured data mode (read from user settings, defaulting to config):
 *   - LIVE  → real market data (oracles)
 *   - SIM   → seeded scenario data (stress testing)
 */
export class MarketDataSource {
    static async resolveMode(userId = null) {
        try {
            const settings = await getSettings(userId);
            const mode = settings?.dataMode || DEFAULT_MODE;
            return { mode: mode.toUpperCase(), scenario: settings?.dataScenario || 'stable' };
        } catch (e) {
            return { mode: DEFAULT_MODE, scenario: 'stable' };
        }
    }

    static async getSnapshot(simulationState = {}, opts = {}) {
        const { mode, scenario } = await this.resolveMode(opts.userId);
        if (mode === 'SIM') {
            return SimDataSource.getSnapshot(simulationState, { scenario, ...opts });
        }
        return LiveDataSource.getSnapshot(simulationState, opts);
    }
}
