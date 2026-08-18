// Central chart palette — single source of truth for SVG colors used across
// the recharts components. Mirrors the Tailwind theme tokens in index.css
// (--color-primary/success/error/...) so a future theme swap changes charts
// in one place instead of hunting hex literals.
export const chartColors = {
    primary: '#17c3b2',
    success: '#27a644',
    error: '#eb5757',
    tertiary: '#02b8cc',
    warning: '#f59e0b',
    violet: '#8b5cf6',
    axis: '#383b3f',
    grid: '#23252a',
    tooltipBg: '#161718',
    border: '#ffffff10',
};