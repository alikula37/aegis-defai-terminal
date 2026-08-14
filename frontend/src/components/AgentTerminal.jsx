import { apiFetch } from '../lib/apiClient';
import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';

const INITIAL_LOGS = [
    { time: '--:--:--', text: '🤖 Agent system initialized. Waiting for backend connection...', color: 'text-on-surface-variant' }
];

const typeColorMap = {
    scan: 'text-on-surface',
    flash_loan: 'text-primary',
    rebalance: 'text-green-400',
    claim: 'text-success',
    alert: 'text-amber-400',
    system: 'text-on-surface-variant',
    decision: 'text-cyan-300',
    tool: 'text-on-surface-variant',
};

// 'decision' carries the structured, auditable reasoning (B3-4); 'tool' shows
// which read-only tools the LLM consulted before deciding (B3-2/B3-3).
const ALLOWED_TYPES = ['flash_loan', 'rebalance', 'claim', 'migrate', 'adjust_portfolio', 'reallocate_capital', 'decision', 'tool'];

function parseDetails(logData) {
    // WS payloads carry `details`; REST rows carry `metadata_json` (string).
    let details = logData.details ?? logData.metadata_json ?? null;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch { details = null; }
    }
    return details;
}

function normalizeLog(logData) {
    const { timestamp, message, type: logType } = logData;
    const time = new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
    const color = typeColorMap[logType] || 'text-on-surface';
    const details = parseDetails(logData);
    return { time, text: message, color, type: logType, reasoning: details?.reasoning || null };
}

function ReasoningPanel({ reasoning }) {
    if (!reasoning) return null;
    return (
        <div className="mt-1.5 ml-5 pl-3 border-l border-outline-variant bg-surface-variant/30 rounded-r-md px-2 py-1.5 text-[11px] leading-[16px]">
            <div className="text-on-surface-variant"><span className="text-cyan-300/70">situation:</span> {reasoning.situation}</div>
            <div className="text-on-surface-variant"><span className="text-cyan-300/70">analysis:</span> {reasoning.analysis}</div>
            {Array.isArray(reasoning.alternatives) && reasoning.alternatives.length > 0 && (
                <div className="text-on-surface-variant">
                    <span className="text-cyan-300/70">alternatives:</span>
                    <ul className="list-disc list-inside ml-1">
                        {reasoning.alternatives.map((alt, i) => <li key={i}>{alt}</li>)}
                    </ul>
                </div>
            )}
            <div className="text-on-surface-variant"><span className="text-cyan-300/70">chosen:</span> {reasoning.chosen}</div>
        </div>
    );
}

export default function AgentTerminal() {
    const { agentLogs: wsLogs, isConnected: connected } = useWebSocket();
    const [logs, setLogs] = useState(INITIAL_LOGS);
    const bottomRef = useRef(null);
    const seenKeys = useRef(new Set());

    // Fetch historical logs on mount
    useEffect(() => {
        apiFetch('/api/logs?limit=50')
            .then(r => r.json())
            .then(data => {
                if (data && data.length > 0) {
                    const formattedLogs = data
                        .filter(logData => ALLOWED_TYPES.includes(logData.type))
                        .map(normalizeLog);
                    formattedLogs.forEach(l => seenKeys.current.add(`${l.time}|${l.text}`));
                    setLogs(formattedLogs.reverse());
                }
            })
            .catch(err => console.error("Failed to fetch historical logs:", err));
    }, []);

    // Append WS logs to the existing history instead of replacing it — the
    // REST snapshot stays visible and only genuinely new entries are added.
    useEffect(() => {
        if (wsLogs && wsLogs.length > 0) {
            const fresh = [];
            for (let i = wsLogs.length - 1; i >= 0; i--) { // oldest of the batch first
                const logData = wsLogs[i];
                if (!ALLOWED_TYPES.includes(logData.type)) continue;
                const l = normalizeLog(logData);
                const key = `${l.time}|${l.text}`;
                if (seenKeys.current.has(key)) continue;
                seenKeys.current.add(key);
                fresh.push(l);
            }
            if (fresh.length > 0) {
                setLogs(prev => [...prev, ...fresh].slice(-100));
            }
        }
    }, [wsLogs]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="bg-slate-950 border border-outline-variant rounded-md flex flex-col overflow-hidden">
            <div className="bg-surface-container-highest px-4 py-2 border-b border-outline-variant flex items-center gap-2">
                <span className="material-symbols-outlined text-on-surface-variant text-[16px]">terminal</span>
                <h3 className="font-[JetBrains_Mono] text-[13px] leading-[16px] font-medium text-on-surface">AI Agent Execution Logs</h3>
                <div className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-[JetBrains_Mono] uppercase tracking-wider ${connected ? 'bg-success/10 border-success/20 text-success' : 'bg-surface-variant border-outline-variant text-on-surface-variant'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-outline'}`}></span>
                    {connected ? 'WS' : 'OFF'}
                </div>
            </div>
            <div className="p-4 font-[JetBrains_Mono] text-[12px] leading-[18px] text-on-surface-variant h-72 overflow-y-auto flex flex-col gap-2">
                {logs.map((log, i) => (
                    <div key={i} className="hover:bg-surface-variant/50 p-1 rounded transition-colors">
                        <div className="flex gap-3">
                            <span className="text-outline shrink-0">[{log.time}]</span>
                            <span className={log.color}>{log.text}</span>
                        </div>
                        {log.type === 'decision' && <ReasoningPanel reasoning={log.reasoning} />}
                    </div>
                ))}
                <div ref={bottomRef} className="flex gap-3 p-1 mt-2 items-center">
                    <span className="text-outline shrink-0">[Live]</span>
                    <span className="w-2 h-4 bg-primary/70 animate-pulse inline-block"></span>
                </div>
            </div>
        </div>
    );
}
