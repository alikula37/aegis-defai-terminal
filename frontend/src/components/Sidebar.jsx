import { apiFetch } from '../lib/apiClient';
import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from './ConfirmDialog';
import DocsModal from './DocsModal';
import SupportModal from './SupportModal';

export const navItems = [
    { to: '/', icon: 'dashboard', label: 'Overview' },
    { to: '/yield-strategies', icon: 'account_balance_wallet', label: 'Yield Strategies' },
    { to: '/live-data', icon: 'sensors', label: 'Live Data' },
    { to: '/ai-agent-logs', icon: 'terminal', label: 'AI Agent Logs' },
    { to: '/settings', icon: 'settings', label: 'Settings' },
];

export default function Sidebar() {
    const { isSimulationRunning: isRunning, setIsSimulationRunning, setIsStartModalOpen, setIsResumeModalOpen, simulationStartTime, clearSimulationData } = useWebSocket();
    const toast = useToast();
    const [isDocsOpen, setIsDocsOpen] = useState(false);
    const [isSupportOpen, setIsSupportOpen] = useState(false);
    const [uptime, setUptime] = useState('00:00:00');
    const [hasPastSim, setHasPastSim] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

    useEffect(() => {
        let interval;
        if (isRunning && simulationStartTime) {
            interval = setInterval(() => {
                const diff = Math.floor((Date.now() - simulationStartTime) / 1000);
                const h = Math.floor(diff / 3600).toString().padStart(2, '0');
                const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
                const s = (diff % 60).toString().padStart(2, '0');
                setUptime(`${h}:${m}:${s}`);
            }, 1000);
        } else {
            setUptime('00:00:00');
        }
        return () => clearInterval(interval);
    }, [isRunning, simulationStartTime]);

    // When stopped, learn whether there is anything to delete/resume.
    useEffect(() => {
        if (!isRunning) {
            apiFetch('/api/simulations')
                .then(res => res.ok ? res.json() : [])
                .then(list => setHasPastSim(Array.isArray(list) && list.length > 0))
                .catch(() => setHasPastSim(false));
        }
    }, [isRunning]);

    const handleStopSimulation = async () => {
        // Optimistic UI update
        setIsSimulationRunning(false);
        try {
            const res = await apiFetch('/api/simulation/stop', {
                method: 'POST'
            });
            if (res.ok) {
                // Sharp separation: dropping the old run's data immediately,
                // without waiting for the WS broadcast.
                clearSimulationData();
                toast.success('Simulation stopped');
            } else {
                // Revert if failed
                setIsSimulationRunning(true);
                const errData = await res.json();
                toast.error(`Failed to stop simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            setIsSimulationRunning(true);
            toast.error(`Failed to stop simulation: ${error.message}`);
        }
    };

    const handleDeleteLastSimulation = async () => {
        setIsDeleting(true);
        try {
            const list = await apiFetch('/api/simulations')
                .then(res => res.ok ? res.json() : [])
                .catch(() => []);
            const latest = Array.isArray(list) && list.length > 0 ? list[0] : null;
            if (!latest) {
                setHasPastSim(false);
                return;
            }
            const res = await apiFetch(`/api/simulation/${latest.id}`, { method: 'DELETE' });
            if (res.ok) {
                setHasPastSim(false);
                clearSimulationData();
                toast.success('Simulation deleted');
            } else {
                const errData = await res.json();
                toast.error(`Failed to delete simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to delete simulation:', error);
            toast.error(`Failed to delete simulation: ${error.message}`);
        } finally {
            setIsDeleting(false);
        }
    };



    return (
        <aside className="fixed left-0 top-0 h-full w-[280px] border-r border-outline-variant bg-surface-container-low flex flex-col p-[1rem] z-50 hidden md:flex">
            {/* Logo */}
            <div className="mb-[2rem] px-[0.5rem] flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-on-primary-container text-sm">terminal</span>
                </div>
                <div>
                    <h1 className="font-[Inter] text-[24px] leading-[32px] font-[510] text-paper tracking-tight">AEGIS DeFAI</h1>
                    <p className="font-[JetBrains_Mono] text-[12px] leading-[18px] text-success flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-success' : 'bg-outline'} relative`}>
                            {isRunning && <span className="absolute inset-0 rounded-full bg-success pulse-ring"></span>}
                        </span>
                        {isRunning ? 'AI-Agent Active' : 'AI-Agent Idle'}
                    </p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 flex flex-col gap-1">
                {navItems.map((item) => (
                    <NavLink
                        key={item.label}
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${isActive
                                ? 'text-primary font-[510] bg-primary/10'
                                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
                            }`
                        }
                    >
                        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                        <span className="font-[Inter] text-[14px] leading-[20px] tracking-[-0.01em]">{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Bottom */}
            <div className="mt-auto space-y-4">
                {/* Simulation Control Panel */}
                <div className="p-4 rounded-xl bg-surface-container border border-outline-variant">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-[Inter] text-[14px] font-semibold text-on-surface flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">play_circle</span>
                            Simulation Control
                        </h3>
                        {/* Status Badge */}
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-[JetBrains_Mono] font-bold ${isRunning ? 'bg-success/10 text-success border border-success/20' : 'bg-error/10 text-error border border-error/20'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-success animate-pulse' : 'bg-error'}`}></span>
                            {isRunning ? 'RUNNING' : 'STOPPED'}
                        </div>
                    </div>

                    {isRunning && (
                        <div className="mb-3 flex justify-between items-center text-[12px] font-[JetBrains_Mono] text-on-surface-variant bg-surface-container-highest px-3 py-1.5 rounded-md border border-outline-variant/30">
                            <span>Uptime:</span>
                            <span className="text-primary font-bold tracking-wider">{uptime}</span>
                        </div>
                    )}
                    <div className="space-y-3">
                        {!isRunning && (
                            <>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsStartModalOpen(true)}
                                        className="flex-1 py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors flex items-center justify-center gap-1 bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">play_circle</span>
                                        Start New
                                    </button>
                                    <button
                                        onClick={() => setIsResumeModalOpen(true)}
                                        className="flex-1 py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors flex items-center justify-center gap-1 border border-primary text-primary hover:bg-primary/10"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">restore</span>
                                        Resume
                                    </button>
                                </div>
                                {hasPastSim && (
                                    <button
                                        onClick={() => setIsDeleteConfirmOpen(true)}
                                        disabled={isDeleting}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-[JetBrains_Mono] text-on-surface-variant hover:text-error transition-colors rounded-md hover:bg-error/5 disabled:opacity-50"
                                        title="Delete the last simulation and all its data"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">delete_forever</span>
                                        {isDeleting ? 'Deleting...' : 'Delete last simulation'}
                                    </button>
                                )}
                            </>
                        )}

                        {isRunning && (
                            <button
                                onClick={handleStopSimulation}
                                className="w-full py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors flex items-center justify-center gap-2 bg-error text-on-error hover:bg-error-container hover:text-on-error-container"
                            >
                                <span className="material-symbols-outlined text-[16px]">stop_circle</span>
                                Stop Simulation
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex border-t border-outline-variant pt-4 gap-1">
                    <button onClick={() => setIsDocsOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-md transition-colors">
                        <span className="material-symbols-outlined text-[18px]">description</span>
                        <span className="text-[14px]">Docs</span>
                    </button>
                    <button onClick={() => setIsSupportOpen(true)} className="flex-1 flex items-center justify-center gap-2 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-md transition-colors">
                        <span className="material-symbols-outlined text-[18px]">help</span>
                        <span className="text-[14px]">Support</span>
                    </button>
                </div>
            </div>

            <DocsModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
            <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} />
            <ConfirmDialog
                isOpen={isDeleteConfirmOpen}
                title="Delete last simulation?"
                message="Its portfolio, logs and decisions will be permanently removed. This cannot be undone."
                confirmLabel="Delete"
                onCancel={() => setIsDeleteConfirmOpen(false)}
                onConfirm={() => {
                    setIsDeleteConfirmOpen(false);
                    handleDeleteLastSimulation();
                }}
            />
        </aside>
    );
}
