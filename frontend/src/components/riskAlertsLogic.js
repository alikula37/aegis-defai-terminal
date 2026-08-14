// Pure risk-alert derivation from a portfolio snapshot + settings.
// Kept separate from the component so Fast Refresh stays clean.

export function deriveRiskAlerts(portfolio, settings) {
    if (!portfolio) {
        return [{
            type: 'neutral',
            icon: 'monitor_heart',
            title: 'Awaiting market data',
            description: 'Connect to the backend to stream live oracle updates.',
            bgClass: 'bg-surface-variant border-outline-variant',
            iconColor: 'text-on-surface-variant',
            titleColor: 'text-on-surface',
            descColor: 'text-on-surface-variant',
        }];
    }

    const targetHf = settings?.targetHf ?? 1.25;
    const maxGasClaim = settings?.maxGasClaim ?? 20;
    const alerts = [];

    const hf = Number(portfolio.healthFactor) || 0;
    const spread = portfolio.baseSpread != null
        ? Number(portfolio.baseSpread)
        : (portfolio.netApy != null ? Number(portfolio.netApy) : 0);
    const gasPrice = Number(portfolio.gasPrice) || 0;

    if (String(portfolio.oracleStatus || '').toUpperCase().startsWith('SIM')) {
        alerts.push({
            type: 'neutral',
            icon: 'science',
            title: `SIM data source active (${portfolio.oracleStatus})`,
            description: 'Scenario-driven market data — deterministic, no live network calls.',
            bgClass: 'bg-purple-900/20 border-purple-900/50',
            iconColor: 'text-purple-400',
            titleColor: 'text-purple-300',
            descColor: 'text-purple-300/70',
        });
    }

    if (hf > 0 && hf < targetHf) {
        alerts.push({
            type: 'danger',
            icon: 'shield_moon',
            title: `Health Factor ${hf.toFixed(2)} below target ${targetHf.toFixed(2)}`,
            description: 'Agent will rebalance or rescue to restore a safe margin.',
            bgClass: 'bg-red-900/20 border-red-900/50',
            iconColor: 'text-error',
            titleColor: 'text-error',
            descColor: 'text-error/70',
        });
    }

    if (spread < 0) {
        alerts.push({
            type: 'danger',
            icon: 'trending_down',
            title: `Negative yield spread (${spread.toFixed(2)}%)`,
            description: 'Borrow cost exceeds supply yield — agent is unwinding leverage.',
            bgClass: 'bg-amber-900/20 border-amber-900/50',
            iconColor: 'text-amber-400',
            titleColor: 'text-amber-300',
            descColor: 'text-amber-300/70',
        });
    } else if (spread > 0) {
        alerts.push({
            type: 'success',
            icon: 'verified_user',
            title: `Positive yield spread (${spread.toFixed(2)}%)`,
            description: 'Yield capture window is open. Agent monitoring for entry.',
            bgClass: 'bg-green-900/20 border-green-900/50',
            iconColor: 'text-green-400',
            titleColor: 'text-green-400',
            descColor: 'text-green-400/70',
        });
    }

    if (gasPrice > 0 && gasPrice > maxGasClaim) {
        alerts.push({
            type: 'warning',
            icon: 'local_gas_station',
            title: `Gas price high (${gasPrice.toFixed(2)} gwei)`,
            description: `Above claim threshold (${maxGasClaim} gwei). Reward claims deferred.`,
            bgClass: 'bg-orange-900/20 border-orange-900/50',
            iconColor: 'text-orange-400',
            titleColor: 'text-orange-300',
            descColor: 'text-orange-300/70',
        });
    }

    return alerts;
}
