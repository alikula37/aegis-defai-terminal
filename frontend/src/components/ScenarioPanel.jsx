import { useState, useEffect, useRef } from 'react';
import ChartCard from './ChartCard';
import { fmtPct } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

function Slider({ label, value, min, max, step, unit, onChange }) {
    return (
        <label className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
                <span className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider">{label}</span>
                <span className="font-[Inter] text-[13px] font-bold tabular-nums text-on-surface">{value}{unit}</span>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full accent-[#17c3b2]"
                aria-label={label}
            />
        </label>
    );
}

export default function ScenarioPanel({ market }) {
    const { t, lang } = useI18n();
    const [susde, setSusde] = useState(4.5);
    const [borrow, setBorrow] = useState(6);
    const [leverage, setLeverage] = useState(4);
    const [gas, setGas] = useState(0.5);
    const seeded = useRef(false);

    // Seed the sliders with the live market baseline the first time it arrives,
    // without clobbering the user's tweaks afterwards.
    useEffect(() => {
        if (seeded.current) return;
        if (market?.susdeApy != null) setSusde(Number(market.susdeApy));
        if (market?.morphoBorrowApy != null) setBorrow(Number(market.morphoBorrowApy));
        if (market?.loopNetApy != null || market?.susdeApy != null) seeded.current = true;
    }, [market]);

    const netApy = susde * leverage - borrow * (leverage - 1) - gas;
    const positive = netApy >= 0;

    return (
        <ChartCard
            title={t('analytics.scenarioTitle')}
            subtitle={t('analytics.scenarioSubtitle')}
            icon="tune"
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <Slider label={t('analytics.scenarioSusde')} value={susde} min={0} max={20} step={0.25} unit="%" onChange={setSusde} />
                <Slider label={t('analytics.scenarioBorrow')} value={borrow} min={0} max={20} step={0.25} unit="%" onChange={setBorrow} />
                <Slider label={t('analytics.scenarioLeverage')} value={leverage} min={1} max={10} step={0.5} unit="x" onChange={setLeverage} />
                <Slider label={t('analytics.scenarioGas')} value={gas} min={0} max={3} step={0.1} unit="%" onChange={setGas} />
            </div>

            <div className={`mt-4 rounded-xl p-4 border flex items-center justify-between gap-3 flex-wrap ${positive ? 'bg-success/10 border-success/30' : 'bg-error/10 border-error/30'}`}>
                <div>
                    <p className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-on-surface-variant">{t('analytics.scenarioNetApy')}</p>
                    <p className={`font-[Inter] text-[30px] font-bold tabular-nums leading-none ${positive ? 'text-success' : 'text-error'}`}>
                        {fmtPct(netApy, { locale: lang, fractionDigits: 1, signed: true })}
                    </p>
                </div>
                <p className={`font-[JetBrains_Mono] text-[12px] leading-relaxed ${positive ? 'text-success' : 'text-error'}`}>
                    {positive ? t('analytics.scenarioNetPositive') : t('analytics.scenarioNetNegative')}
                </p>
            </div>
        </ChartCard>
    );
}
