export class StrategyManager {
    static getStrategies(portfolio, marketData, pointsData) {
        return [
            {
                name: 'Pendle PT-sUSDe Arb',
                protocol: 'Pendle Finance',
                apy: marketData.netApy,
                tvl: portfolio.tvl * 0.55,
                risk: 'Low',
                status: 'ACTIVE',
                borrowProtocol: marketData.bestBorrowApy === marketData.aaveV4BorrowApy ? 'Aave V4 E-Mode' : 'Morpho Blue',
                borrowApy: marketData.bestBorrowApy,
                points: { morpho: pointsData.morphoPointsApy, ena: pointsData.enaPointsApy }
            },
            {
                name: 'PT-syrupUSDC RWA',
                protocol: 'Maple Finance + Aave V4',
                apy: marketData.rwaNetApy,
                tvl: portfolio.tvl * 0.20,
                risk: 'Low',
                status: 'ACTIVE',
                borrowProtocol: 'Aave V4 E-Mode',
                borrowApy: marketData.aaveV4BorrowApy,
                points: { morpho: 0, ena: 0 }
            },
            {
                name: 'Ethena sUSDe Leverage',
                protocol: 'Ethena + Morpho',
                apy: marketData.ethenaNetApy,
                tvl: portfolio.tvl * 0.15,
                risk: 'Med',
                status: 'ACTIVE',
                borrowProtocol: 'Morpho Blue',
                borrowApy: marketData.morphoBorrowApy,
                points: { morpho: pointsData.morphoPointsApy, ena: pointsData.enaPointsApy * 1.5 }
            },
            {
                name: 'Boros YU Hedge',
                protocol: 'Pendle Boros',
                apy: pointsData.borosFundingYield,
                tvl: portfolio.tvl * 0.05,
                risk: 'Med',
                status: pointsData.borosFundingYield > 0.5 ? 'ACTIVE' : 'STANDBY',
                borrowProtocol: 'N/A (Margin)',
                borrowApy: 0,
                points: { morpho: 0, ena: 0 }
            },
            {
                name: 'Morpho USDC Revolver',
                protocol: 'Morpho Blue',
                apy: marketData.morphoPoolApy,
                tvl: portfolio.tvl * 0.05,
                risk: 'Low',
                status: 'ACTIVE',
                borrowProtocol: 'N/A (Supply)',
                borrowApy: 0,
                points: { morpho: pointsData.morphoPointsApy, ena: 0 }
            }
        ];
    }
}
