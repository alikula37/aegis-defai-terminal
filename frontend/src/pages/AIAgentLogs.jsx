import { apiFetch } from '../lib/apiClient';
import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';

const LOG_TYPES = ['All', 'scan', 'flash_loan', 'rebalance', 'claim', 'alert', 'system'];

export default function AIAgentLogs() {
    const { agentLogs: wsLogs, isConnected: connected } = useWebSocket();
    const [logs, setLogs] = useState([]);
    const [filterType, setFilterType] = useState('All');
    const [filterDate, setFilterDate] = useState('');
    const bottomRef = useRef(null);

    // Fetch historical logs
    useEffect(() => {
        apiFetch('/api/logs')
            .then(r => r.json())
            .then(data => setLogs(Array.isArray(data) ? data : []))
            .catch(() => {
                setLogs([
                    { id: 1, timestamp: new Date().toISOString(), type: 'system', message: '🤖 Agent system initialized. Waiting for backend connection...' }
                ]);
            });
    }, []);

    // WebSocket for live logs
    useEffect(() => {
        if (wsLogs && wsLogs.length > 0) {
            // wsLogs is an array of new logs, we need to merge them with historical logs
            // Since wsLogs is already sorted newest first, we can just prepend them
            // But to avoid duplicates, we can just replace the logs state with the latest from wsLogs if we want
            // For simplicity, let's just append the latest log if it's not already in the list
            const latestLog = wsLogs[0];
            setLogs(prev => {
                // Check if the latest log is already in the list
                if (prev.some(l => l.timestamp === latestLog.timestamp && l.message === latestLog.message)) {
                    return prev;
                }
                return [...prev, latestLog];
            });
        }
    }, [wsLogs]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const filtered = logs.filter(log => {
        if (filterType !== 'All' && log.type !== filterType) return false;
        if (filterDate && !log.timestamp?.startsWith(filterDate)) return false;
        return true;
    });

    const typeColor = (type) => {
        const map = { scan: 'text-on-surface', flash_loan: 'text-primary', rebalance: 'text-success', claim: 'text-success', alert: 'text-warning', system: 'text-on-surface-variant' };
        return map[type] || 'text-on-surface';
    };

    const typeBadgeColor = (type) => {
        const map = { scan: 'bg-surface-variant text-on-surface-variant', flash_loan: 'bg-primary/10 text-primary border-primary/20', rebalance: 'bg-success/10 text-success border-green-400/20', claim: 'bg-success/10 text-success border-success/20', alert: 'bg-warning/10 text-warning border-amber-400/20', system: 'bg-surface-variant text-on-surface-variant' };
        return map[type] || 'bg-surface-variant text-on-surface-variant';
    };

    const formatTime = (ts) => {
        try { return new Date(ts).toLocaleTimeString('en-US', { hour12: false }); } catch { return '--:--:--'; }
    };

    return (
        <div className="flex-1 flex flex-col p-[1.5rem] gap-4 overflow-hidden">
            {/* Header + Filters */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                    <h2 className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface">Agent Execution Logs</h2>
                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-[JetBrains_Mono] uppercase tracking-wider ${connected ? 'bg-success/10 border-success/20 text-success' : 'bg-surface-variant border-outline-variant text-on-surface-variant'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-outline'}`}></span>
                        {connected ? 'Live' : 'Offline'}
                    </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                    <input
                        type="date"
                        value={filterDate}
                        onChange={e => setFilterDate(e.target.value)}
                        className="bg-surface-container border border-outline-variant rounded-lg px-3 py-1.5 text-on-surface text-[13px] font-[JetBrains_Mono] outline-none focus:border-primary transition-colors"
                    />
                    <select
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        className="bg-surface-container border border-outline-variant rounded-lg px-3 py-1.5 text-on-surface text-[13px] font-[JetBrains_Mono] outline-none focus:border-primary transition-colors"
                    >
                        {LOG_TYPES.map(t => <option key={t} value={t}>{t === 'All' ? 'All Types' : t.replace('_', ' ').toUpperCase()}</option>)}
                    </select>
                    <span className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant">{filtered.length} entries</span>
                </div>
            </div>

            {/* Terminal */}
            <div className="flex-1 bg-[#020617] border border-outline-variant rounded-md flex flex-col overflow-hidden min-h-0">
                <div className="bg-surface-container-highest px-4 py-2 border-b border-outline-variant flex items-center gap-2 shrink-0">
                    <span className="material-symbols-outlined text-on-surface-variant text-[16px]">terminal</span>
                    <span className="font-[JetBrains_Mono] text-[13px] font-medium text-on-surface">aegis-defai-agent</span>
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant ml-auto">PID: 1337</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-[JetBrains_Mono] text-[12px] leading-[20px] flex flex-col gap-1">
                    {filtered.map((log, i) => (
                        <div key={log.id || i} className="flex gap-3 hover:bg-surface-variant/30 px-2 py-1 rounded transition-colors items-start">
                            <span className="text-outline shrink-0">[{formatTime(log.timestamp)}]</span>
                            <span className={`shrink-0 px-1.5 py-0 rounded border text-[10px] uppercase tracking-wider ${typeBadgeColor(log.type)}`}>{log.type?.replace('_', ' ') || 'log'}</span>
                            <span className={typeColor(log.type)}>{log.message}</span>
                        </div>
                    ))}
                    <div ref={bottomRef} className="flex gap-3 px-2 py-1 mt-1 items-center">
                        <span className="text-outline shrink-0">[Live]</span>
                        <span className="w-2 h-4 bg-primary/70 animate-pulse inline-block"></span>
                    </div>
                </div>
            </div>
        </div>
    );
}
