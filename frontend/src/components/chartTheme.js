// Shared recharts theming — one place for axis/grid/tooltip styling so every
// chart renders consistently AND stays responsive. Key rule: NO negative left
// margins (they clip Y-axis labels on narrow viewports); the Y axis reserves
// its own width via the `width` prop instead.
import { chartColors } from '../lib/chartColors';

export const axis = {
    stroke: chartColors.axis,
    fontSize: 10,
    fontFamily: 'JetBrains Mono',
    tickLine: false,
    axisLine: false,
};

export const xAxis = {
    ...axis,
    tickMargin: 10,
    minTickGap: 24,
};

export const yAxis = {
    ...axis,
    tickMargin: 8,
    width: 52,
};

export const grid = {
    strokeDasharray: '3 3',
    stroke: chartColors.grid,
    vertical: false,
};

export const tooltipCursor = {
    stroke: chartColors.primary,
    strokeWidth: 1,
    strokeDasharray: '4 4',
    opacity: 0.4,
};

// Recharts charts inside ResponsiveContainer can emit a resize warning when
// the parent is not measured on mount. Standard mitigation: give the wrapper
// an explicit height class and let ResponsiveContainer fill it.
export const chartWrap = 'w-full h-full min-h-0';

/** Shared tooltip shell (surface + border + shadow) used by custom tooltips. */
export function tooltipShell(extra = '') {
    return `bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl ${extra}`;
}