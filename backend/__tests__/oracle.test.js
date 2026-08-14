import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { OracleService } from '../services/OracleService.js';

const originalFetch = global.fetch;

beforeEach(() => {
    OracleService.clearCaches();
});

afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
});

const mockJson = (data) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(data) });

describe('OracleService', () => {
    it('getHistoricalPoolApy returns sorted points for a pool', async () => {
        global.fetch = vi.fn().mockResolvedValue(mockJson({
            status: 'success',
            data: [
                { timestamp: '2026-07-01T00:00:00.000Z', apy: 5.0 },
                { timestamp: '2026-07-02T00:00:00.000Z', apy: 4.5 },
            ],
        }));

        const points = await OracleService.getHistoricalPoolApy('some-pool', 0);
        expect(points.length).toBe(2);
        expect(points[0].apy).toBe(5.0);
        expect(points[1].apy).toBe(4.5);
        expect(points[0].timestamp).toContain('2026-07-01');
    });

    it('getFundingRates parses fundingRate strings to floats', async () => {
        global.fetch = vi.fn().mockResolvedValue(mockJson([
            { coin: 'ETH', fundingRate: '0.0000125', time: Date.now() - 3600000 },
            { coin: 'ETH', fundingRate: '0.0000130', time: Date.now() },
        ]));

        const rates = await OracleService.getFundingRates('ETH', 24);
        expect(rates.length).toBe(2);
        expect(rates[0].fundingRate).toBe(0.0000125);
    });

    it('getMorphoUsdcRates returns APY as percent from fraction', async () => {
        global.fetch = vi.fn().mockResolvedValue(mockJson({
            data: {
                markets: {
                    items: [
                        {
                            marketId: 'm1',
                            state: { borrowApy: 0.05, supplyApy: 0.04, utilization: 0.5, borrowAssetsUsd: 1000000 },
                        },
                        {
                            marketId: 'm2',
                            state: { borrowApy: 3000, supplyApy: 3000, utilization: 1, borrowAssetsUsd: 5000000 },
                        },
                    ],
                },
            },
        }));

        const rates = await OracleService.getMorphoUsdcRates(1, '0xUSDC');
        expect(rates.borrowApy).toBeCloseTo(5.0);
        expect(rates.supplyApy).toBeCloseTo(4.0);
    });

    it('getMorphoUsdcRates falls back to zero when only dust markets exist', async () => {
        global.fetch = vi.fn().mockResolvedValue(mockJson({
            data: { markets: { items: [{ marketId: 'm1', state: { borrowApy: 0.9, supplyApy: 0, utilization: 0, borrowAssetsUsd: 0 } }] } },
        }));

        const rates = await OracleService.getMorphoUsdcRates(1, '0xUSDC');
        expect(rates.borrowApy).toBe(0);
        expect(rates.marketId).toBeNull();
    });
});
