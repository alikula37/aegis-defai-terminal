import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../contexts/AuthContext';

const pageTitles = {
    '/': 'Portfolio Overview',
    '/yield-strategies': 'Yield Strategies',
    '/ai-agent-logs': 'AI Agent Logs',
    '/settings': 'Settings',
};

export default function TopNav() {
    const location = useLocation();
    const { notifications, setNotifications, simulationName, isSimulationRunning, executionStatus } = useWebSocket();
    const { user, authRequired, logout } = useAuth();
    const [showNotifications, setShowNotifications] = useState(false);

    const title = pageTitles[location.pathname] || 'Portfolio Overview';
    const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const isOnchain = executionStatus?.mode === 'onchain';
    const onchainReady = isOnchain && executionStatus?.ready;
    const walletShort = executionStatus?.signerAddress
        ? `${executionStatus.signerAddress.slice(0, 6)}…${executionStatus.signerAddress.slice(-4)}`
        : null;

    return (
        <header className="flex justify-between items-center h-16 px-[1.5rem] border-b border-outline-variant bg-surface-container-low sticky top-0 z-40 w-full shadow-[0_4px_20px_-10px_rgba(0,0,0,0.5)]">
            <div className="flex flex-col">
                <div className="flex items-center gap-3">
                    <h2 className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface">{title}</h2>
                    {isSimulationRunning && (
                        <span className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-md text-[12px] font-[JetBrains_Mono] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                            {simulationName}
                        </span>
                    )}
                </div>
                <span className="font-[Inter] text-[14px] leading-[20px] text-on-surface-variant">{currentDate}</span>
            </div>
            <div className="flex items-center gap-4">
                {executionStatus && (
                    <span
                        title={isOnchain
                            ? onchainReady
                                ? `Onchain execution · chain ${executionStatus.chainId} · wallet ${executionStatus.signerAddress}`
                                : 'Onchain mode is not ready: configure EVM_PROVIDER_URL + EVM_PRIVATE_KEY, or switch execution.mode="simulation". Agent runs read-only.'
                            : 'Simulation execution — no real transactions broadcast'}
                        className={`px-2 py-0.5 rounded-md text-[12px] font-[JetBrains_Mono] flex items-center gap-1 border ${isOnchain ? (onchainReady ? 'bg-success/10 text-success border-success/25' : 'bg-error/10 text-error border-error/25') : 'bg-surface-variant/50 text-on-surface-variant border-outline-variant'}`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${isOnchain ? (onchainReady ? 'bg-success animate-pulse' : 'bg-error') : 'bg-on-surface-variant'}`}></span>
                        {isOnchain ? `Onchain · ${walletShort || 'no wallet'}` : 'Simulation'}
                    </span>
                )}
                <div className="relative">
                    <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="text-on-surface-variant hover:text-primary transition-colors p-1.5 rounded-full hover:bg-surface-variant relative"
                        aria-label="Notifications"
                    >
                        <span className="material-symbols-outlined">notifications</span>
                        {notifications && notifications.length > 0 && (
                            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-error rounded-full border-2 border-surface-container-low"></span>
                        )}
                    </button>

                    {showNotifications && (
                        <div className="absolute right-0 mt-2 w-80 bg-surface-container-high border border-outline-variant rounded-xl shadow-lg z-50 overflow-hidden">
                            <div className="p-3 border-b border-outline-variant flex justify-between items-center">
                                <h3 className="font-semibold text-on-surface text-sm">Notifications</h3>
                                {notifications && notifications.length > 0 && (
                                    <button
                                        onClick={() => setNotifications([])}
                                        className="text-xs text-primary hover:underline"
                                    >
                                        Clear All
                                    </button>
                                )}
                            </div>
                            <div className="max-h-96 overflow-y-auto">
                                {!notifications || notifications.length === 0 ? (
                                    <div className="p-4 text-center text-on-surface-variant text-sm">
                                        No new notifications
                                    </div>
                                ) : (
                                    notifications.map((notif, idx) => (
                                        <div key={idx} className="p-3 border-b border-outline-variant last:border-0 hover:bg-surface-container transition-colors">
                                            <div className="flex items-start gap-2">
                                                <span className={`material-symbols-outlined text-[18px] ${notif.type === 'error' ? 'text-error' : 'text-primary'}`}>
                                                    {notif.type === 'error' ? 'error' : 'info'}
                                                </span>
                                                <div>
                                                    <p className="text-sm text-on-surface">{notif.message}</p>
                                                    <span className="text-xs text-on-surface-variant mt-1 block">
                                                        {new Date(notif.timestamp).toLocaleTimeString()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {authRequired && user && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-variant/50 border border-outline-variant">
                        <span className="material-symbols-outlined text-[18px] text-on-surface-variant">person</span>
                        <div className="flex flex-col leading-tight">
                            <span className="text-[13px] font-medium text-on-surface">{user.username}</span>
                            <span className="text-[11px] text-on-surface-variant">{user.role}</span>
                        </div>
                        <button
                            onClick={() => logout()}
                            title="Sign out"
                            aria-label="Sign out"
                            className="ml-1 text-on-surface-variant hover:text-error transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px]">logout</span>
                        </button>
                    </div>
                )}
                <button
                    disabled
                    title="Wallet connection arrives in Phase 2 (onchain execution)."
                    className="bg-primary-container text-on-primary-container px-4 py-1.5 rounded-lg text-[14px] font-medium opacity-50 cursor-not-allowed flex items-center gap-2"
                >
                    <span className="material-symbols-outlined text-[18px]">account_balance_wallet</span>
                    Connect Wallet
                </button>
            </div>
        </header>
    );
}
