// Pure risk-alert derivation from a portfolio snapshot + settings.
// Kept separate from the component so Fast Refresh stays clean.
// Returns i18n *keys* + interpolation vars — the component translates.
// The logic stays deterministic and unit-testable without a t() function.

const EMPTY_ALERT = {
    type: 'neutral',
    icon: 'monitor_heart',
    titleKey: 'riskAlert.awaitingTitle',
    descKey: 'riskAlert.awaitingDesc',
    bgClass: 'bg-surface-variant border-outline-variant',
    iconColor: 'text-on-surface-variant',
    titleColor: 'text-on-surface',
    descColor: 'text-on-surface-variant',
};

function simModeAlert(status) {
    return {
        type: 'neutral',
        icon: 'science',
        titleKey: 'riskAlert.simTitle',
        titleVars: { status },
        descKey: 'riskAlert.simDesc',
        bgClass: 'bg-iris-violet/10 border-iris-violet/30',
        iconColor: 'text-secondary',
        titleColor: 'text-secondary',
        descColor: 'text-secondary',
    };
}

function healthFactorAlert(hf, targetHf) {
    return {
        type: 'danger',
        icon: 'shield_moon',
        titleKey: 'riskAlert.hfTitle',
        titleVars: { hf: hf.toFixed(2), targetHf: targetHf.toFixed(2) },
        descKey: 'riskAlert.hfDesc',
        bgClass: 'bg-error/10 border-error/30',
        iconColor: 'text-error',
        titleColor: 'text-error',
        descColor: 'text-error/70',
    };
}

function spreadAlert(spread) {
    if (spread < 0) {
        return {
            type: 'danger',
            icon: 'trending_down',
            titleKey: 'riskAlert.spreadNegTitle',
            titleVars: { spread: spread.toFixed(2) },
            descKey: 'riskAlert.spreadNegDesc',
            bgClass: 'bg-warning/10 border-warning/30',
            iconColor: 'text-warning',
            titleColor: 'text-warning',
            descColor: 'text-warning',
        };
    }
    return {
        type: 'success',
        icon: 'verified_user',
        titleKey: 'riskAlert.spreadPosTitle',
        titleVars: { spread: spread.toFixed(2) },
        descKey: 'riskAlert.spreadPosDesc',
        bgClass: 'bg-success/10 border-success/30',
        iconColor: 'text-success',
        titleColor: 'text-success',
        descColor: 'text-success',
    };
}

function gasAlert(gasPrice, maxGasClaim) {
    return {
        type: 'warning',
        icon: 'local_gas_station',
        titleKey: 'riskAlert.gasTitle',
        titleVars: { gas: gasPrice.toFixed(2) },
        descKey: 'riskAlert.gasDesc',
        descVars: { maxGas: maxGasClaim },
        bgClass: 'bg-warning/10 border-warning/30',
        iconColor: 'text-warning',
        titleColor: 'text-warning',
        descColor: 'text-warning',
    };
}

export function deriveRiskAlerts(portfolio, settings) {
    if (!portfolio) return [EMPTY_ALERT];

    const targetHf = settings?.targetHf ?? 1.25;
    const maxGasClaim = settings?.maxGasClaim ?? 20;
    const alerts = [];

    const hf = Number(portfolio.healthFactor) || 0;
    const spread = portfolio.baseSpread != null
        ? Number(portfolio.baseSpread)
        : (portfolio.netApy != null ? Number(portfolio.netApy) : 0);
    const gasPrice = Number(portfolio.gasPrice) || 0;

    if (String(portfolio.oracleStatus || '').toUpperCase().startsWith('SIM')) {
        alerts.push(simModeAlert(portfolio.oracleStatus));
    }

    if (hf > 0 && hf < targetHf) {
        alerts.push(healthFactorAlert(hf, targetHf));
    }

    if (spread !== 0) {
        alerts.push(spreadAlert(spread));
    }

    if (gasPrice > 0 && gasPrice > maxGasClaim) {
        alerts.push(gasAlert(gasPrice, maxGasClaim));
    }

    return alerts;
}