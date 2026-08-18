#!/usr/bin/env node
// Coverage quality gate for CI. Reads vitest's coverage-summary.json and
// fails the build when any required metric drops below the threshold.
// Usage: node scripts/coverage-gate.mjs <path-to-coverage-summary.json> [lines] [statements] [branches] [functions]
// Defaults: lines 70, statements 70, branches 50, functions 65.

import { readFileSync } from 'node:fs';

const summaryPath = process.argv[2];
const thresholdLines = Number(process.argv[3] ?? 70);
const thresholdStatements = Number(process.argv[4] ?? 70);
const thresholdBranches = Number(process.argv[5] ?? 50);
const thresholdFunctions = Number(process.argv[6] ?? 65);

if (!summaryPath) {
    console.error('Usage: node coverage-gate.mjs <coverage-summary.json> [lines] [statements] [branches] [functions]');
    process.exit(2);
}

let summary;
try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch (err) {
    console.error(`Could not read coverage summary at ${summaryPath}: ${err.message}`);
    process.exit(2);
}

const total = summary.total;
if (!total) {
    console.error('Coverage summary has no "total" block — is the coverage report valid?');
    process.exit(2);
}

const checks = [
    { name: 'lines', value: total.lines?.pct ?? 0, threshold: thresholdLines },
    { name: 'statements', value: total.statements?.pct ?? 0, threshold: thresholdStatements },
    { name: 'branches', value: total.branches?.pct ?? 0, threshold: thresholdBranches },
    { name: 'functions', value: total.functions?.pct ?? 0, threshold: thresholdFunctions },
];

let failed = false;
for (const check of checks) {
    const pass = check.value >= check.threshold;
    if (!pass) failed = true;
    console.log(`${pass ? '✅' : '❌'} ${check.name.padEnd(10)} ${check.value.toFixed(1)}%  (min ${check.threshold}%)`);
}

if (failed) {
    console.error(`\nCoverage gate FAILED for ${summaryPath}`);
    process.exit(1);
}
console.log(`\nCoverage gate PASSED for ${summaryPath}`);