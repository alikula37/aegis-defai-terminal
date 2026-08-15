import React, { createContext, useState, useEffect, useContext } from 'react';
import SimulationStartModal from '../components/SimulationStartModal';
import SimulationResumeModal from '../components/SimulationResumeModal';
import { apiFetch } from '../lib/apiClient';
import { useAuth } from './AuthContext';

export const WebSocketContext = createContext();

export const useWebSocket = () => useContext(WebSocketContext);

// Normalize portfolio payload: map snake_case DB fields → camelCase that components expect
function normalizePortfolio(raw) {
    if (!raw) return null;
    return {
        // Core metrics — support both naming conventions
        tvl: raw.tvl ?? 0,
        netApy: raw.netApy ?? raw.net_apy ?? 0,
        healthFactor: raw.healthFactor ?? raw.health_factor ?? 0,
        // Yield oracle
        susdeApy: raw.susdeApy ?? 0,
        pendlePtSusdeApy: raw.pendlePtSusdeApy ?? 0,
        morphoBorrowApy: raw.morphoBorrowApy ?? 0,
        baseSpread: raw.baseSpread ?? 0,
        leverage: raw.leverage ?? 1,
        // Prices
        ethPrice: raw.ethPrice ?? 0,
        usdcPrice: raw.usdcPrice ?? 0,
        susdePrice: raw.susdePrice ?? 0,
        // RPC
        gasPrice: raw.gasPrice ?? 0,
        blockNumber: raw.blockNumber ?? null,
        // Oracle source / richer oracle fields
        oracleStatus: raw.oracleStatus ?? 'LIVE',
        aaveV4BorrowApy: raw.aaveV4BorrowApy ?? 0,
        bestBorrowApy: raw.bestBorrowApy ?? 0,
        points: raw.points ?? {},
        crossChain: raw.crossChain ?? {},
        // Strategy data
        deployedCapital: raw.deployedCapital ?? raw.tvl ?? 0,
        avgStrategyApy: raw.avgStrategyApy ?? raw.netApy ?? raw.net_apy ?? 0,
        activeAgents: raw.activeAgents ?? 0,
        strategies: raw.strategies ?? [],
    };
}

// WS URL: explicit VITE_WS_URL wins; otherwise derive it from VITE_API_URL so
// REST and WS always point at the same host (same-origin, /ws path — matches
// the shipped nginx proxy). Setting only one of the two no longer silently
// leaves the other pointing at localhost.
function defaultWsUrl() {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    try {
        const u = new URL(base);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        u.pathname = `${u.pathname.replace(/\/$/, '')}/ws`;
        return u.toString();
    } catch {
        return 'ws://localhost:3001/ws';
    }
}

export const WebSocketProvider = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [portfolioData, setPortfolioData] = useState(null);
    const [agentLogs, setAgentLogs] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isSimulationRunning, setIsSimulationRunning] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [isStartModalOpen, setIsStartModalOpen] = useState(false);
    const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
    const [hasData, setHasData] = useState(false);
    const [simulationStartTime, setSimulationStartTime] = useState(null);
    const [simulationName, setSimulationName] = useState('Default Simulation');
    const [executionStatus, setExecutionStatus] = useState(null);
    const [isStarting, setIsStarting] = useState(false);

    // Refresh simulation status (running flag, execution backend). In auth
    // mode the provider mounts before login, so the very first attempt gets a
    // 401 and must NOT be the only one — re-run whenever the session appears
    // (login/logout) and after every WS (re)connect.
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        apiFetch('/api/simulation/status')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(data => {
                if (cancelled) return;
                if (data.execution) setExecutionStatus(data.execution);
                if (data.isRunning) {
                    setIsSimulationRunning(true);
                    setHasData(true);
                    setSimulationStartTime(data.startTime);
                    if (data.simulationName) setSimulationName(data.simulationName);
                }
            })
            .catch(err => console.error("Failed to fetch simulation status:", err));
        return () => { cancelled = true; };
    }, [isAuthenticated]);

    // Update hasData when portfolioData changes
    useEffect(() => {
        if (portfolioData && portfolioData.tvl > 0) {
            setHasData(true);
        }
    }, [portfolioData]);

    const handleStartSimulation = async (settings) => {
        setIsStarting(true);
        try {
            const res = await apiFetch('/api/simulation/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            if (res.ok) {
                setHasData(true);
                setIsSimulationRunning(true);
                setIsStartModalOpen(false);
                // Set locally so uptime/name work even if WS is down — the WS
                // simulation_status message (when it arrives) will refresh them.
                setSimulationStartTime(Date.now());
                if (settings.simulationName) setSimulationName(settings.simulationName);
            } else {
                const errData = await res.json();
                alert(`Failed to start simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to start simulation:', error);
            alert(`Failed to start simulation: ${error.message}`);
        } finally {
            setIsStarting(false);
        }
    };

    const handleResumeSimulation = async (simulationId) => {
        setIsStarting(true);
        try {
            const res = await apiFetch('/api/simulation/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ simulationId })
            });
            if (res.ok) {
                setHasData(true);
                setIsSimulationRunning(true);
                setIsResumeModalOpen(false);
            } else {
                const errData = await res.json();
                alert(`Failed to resume simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to resume simulation:', error);
            alert(`Failed to resume simulation: ${error.message}`);
        } finally {
            setIsStarting(false);
        }
    };

    const stopSimulation = async () => {
        try {
            const res = await apiFetch('/api/simulation/stop', { method: 'POST' });
            if (res.ok) {
                setIsSimulationRunning(false);
            } else {
                const errData = await res.json();
                alert(`Failed to stop simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            alert(`Failed to stop simulation: ${error.message}`);
        }
    };

// Exponential backoff for reconnect attempts (1s, 2s, … capped at 30s).
function reconnectDelayMs(retryCount, baseDelay = 1000) {
    return Math.min(baseDelay * Math.pow(2, retryCount), 30000);
}

// Dispatch one parsed WS message to the context setters.
function applyWsMessage(data, setters) {
    if (data.type === 'portfolio_update') {
        setters.setPortfolioData(normalizePortfolio(data.payload));
    } else if (data.type === 'agent_log') {
        setters.setAgentLogs(prev => [data.payload, ...prev].slice(0, 100));
    } else if (data.type === 'simulation_status') {
        setters.setIsSimulationRunning(data.payload.isRunning);
        setters.setSimulationStartTime(data.payload.startTime);
        if (data.payload.simulationName) setters.setSimulationName(data.payload.simulationName);
        if (data.payload.execution) setters.setExecutionStatus(data.payload.execution);
    } else if (data.type === 'notification') {
        setters.setNotifications(prev => [data.payload, ...prev].slice(0, 10));
    }
}

    useEffect(() => {
        let ws;
        let reconnectInterval;
        const MAX_RETRIES = 10;
        const BASE_DELAY = 1000;

        let disposed = false;

        const connect = (initialRetry = 0) => {
            // Local counter — never reassign the parameter (S1226).
            let retryCount = initialRetry;
            try {
                const wsUrl = new URL(import.meta.env.VITE_WS_URL || defaultWsUrl());
                const wsKey = import.meta.env.VITE_WS_API_KEY || 'aegis-default-ws-key';
                // Auth via Sec-WebSocket-Protocol subprotocol (not query string)
                ws = new WebSocket(wsUrl.toString(), [wsKey]);

                ws.onopen = () => {
                    console.log('WebSocket Connected');
                    setIsConnected(true);
                    retryCount = 0; // Reset on successful connect
                    // Refresh status after (re)connect: the initial fetch may
                    // have predated login, and a reconnect means the stream
                    // restarted (missed messages may have carried status).
                    apiFetch('/api/simulation/status')
                        .then(res => res.ok ? res.json() : null)
                        .then(data => {
                            if (!data) return;
                            if (data.execution) setExecutionStatus(data.execution);
                            if (data.isRunning) {
                                setIsSimulationRunning(true);
                                setHasData(true);
                                if (data.startTime) setSimulationStartTime(data.startTime);
                                if (data.simulationName) setSimulationName(data.simulationName);
                            }
                        })
                        .catch(() => { /* non-critical refresh */ });
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        applyWsMessage(data, {
                            setPortfolioData,
                            setAgentLogs,
                            setIsSimulationRunning,
                            setSimulationStartTime,
                            setSimulationName,
                            setExecutionStatus,
                            setNotifications,
                        });
                    } catch (e) {
                        console.error('Error parsing WebSocket message:', e);
                    }
                };

                ws.onclose = () => {
                    console.log('WebSocket Disconnected');
                    setIsConnected(false);
                    if (disposed) return; // unmounted — do not schedule a reconnect
                    if (retryCount < MAX_RETRIES) {
                        const delay = reconnectDelayMs(retryCount, BASE_DELAY);
                        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${retryCount + 1})...`);
                        reconnectInterval = setTimeout(() => connect(retryCount + 1), delay);
                    } else {
                        console.error('[WS] Max reconnection attempts reached.');
                    }
                };

                ws.onerror = (error) => {
                    console.error('WebSocket Error:', error);
                    ws.close();
                };
            } catch (error) {
                console.error('WebSocket Connection Error:', error);
            }
        };

        connect();

        return () => {
            disposed = true;
            if (ws) ws.close();
            if (reconnectInterval) clearTimeout(reconnectInterval);
        };
    }, []);

    return (
        <WebSocketContext.Provider value={{
            portfolioData, agentLogs, isConnected, isSimulationRunning, setIsSimulationRunning,
            notifications, setNotifications,
            isStartModalOpen, setIsStartModalOpen, hasData, setHasData,
            simulationStartTime, simulationName, isStarting, executionStatus,
            isResumeModalOpen, setIsResumeModalOpen, stopSimulation
        }}>
            {children}
            <SimulationStartModal
                isOpen={isStartModalOpen}
                onClose={() => setIsStartModalOpen(false)}
                onStart={handleStartSimulation}
            />
            <SimulationResumeModal
                isOpen={isResumeModalOpen}
                onClose={() => setIsResumeModalOpen(false)}
                onResume={handleResumeSimulation}
            />
        </WebSocketContext.Provider>
    );
};
