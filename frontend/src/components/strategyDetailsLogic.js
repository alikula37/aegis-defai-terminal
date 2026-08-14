// Pure strategy-detail helpers: live yield breakdown + agent timeline mapping.
// Kept separate from the component so Fast Refresh stays clean.

const LOG_META = {
    flash_loan: { icon: 'priority_high', iconColor: 'text-error', label: 'Flash Loan Rescue' },
    alert: { icon: 'warning', iconColor: 'text-amber-400', label: 'Guardrail Alert' },
    de_leverage: { icon: 'trending_down', iconColor: 'text-amber-400', label: 'De-leverage' },
    migrate: { icon: 'swap_horiz', iconColor: 'text-primary', label: 'Borrow Migration' },
    claim: { icon: 'download', iconColor: 'text-success', label: 'Rewards Claim' },
    rebalance: { icon: 'balance', iconColor: 'text-primary', label: 'Rebalance' },
    system: { icon: 'settings', iconColor: 'text-primary', label: 'System' },
    scan: { icon: 'radar', iconColor: 'text-primary', label: 'Market Scan' },
};

export function deriveStrategyBreakdown(strategy, portfolio) {
    const isRwa = /rwa|syrup/i.test(strategy?.name || '');
    const borrowsFromAave = /aave/i.test(strategy?.borrowProtocol || '');

    const baseYield = isRwa
        ? Number(strategy?.apy) || 0
        : Number(portfolio?.susdeApy) || 0;
    const borrowApy = Number(borrowsFromAave ? portfolio?.aaveV4BorrowApy : portfolio?.morphoBorrowApy) || 0;
    const pointsApy = Number(portfolio?.points?.totalPointsApy) || 0;
    const liveNet = portfolio != null && portfolio.netApy != null ? Number(portfolio.netApy) : NaN;

    return {
        baseYield,
        borrowApy,
        pointsApy,
        netApy: !Number.isNaN(liveNet) ? liveNet : baseYield - borrowApy + pointsApy,
    };
}

export function deriveAgentTimeline(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return [];
    return logs.slice(0, 6).map(log => {
        const meta = LOG_META[log.type] || { icon: 'info', iconColor: 'text-primary', label: log.type };
        return {
            ...log,
            title: meta.label,
            icon: meta.icon,
            iconColor: meta.iconColor,
        };
    });
}
