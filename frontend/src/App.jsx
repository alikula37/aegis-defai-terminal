import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './pages/Overview';
import YieldStrategies from './pages/YieldStrategies';
import AIAgentLogs from './pages/AIAgentLogs';
import Settings from './pages/Settings';
import LiveData from './pages/LiveData';
import LoginPage from './pages/LoginPage';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { I18nProvider, useI18n } from './i18n/I18nProvider';
import ErrorBoundary from './components/ErrorBoundary';

function AppShell() {
    const { user, loading } = useAuth();
    const { t } = useI18n();
    // Open mode (AUTH_REQUIRED=false): me() resolves to the local user, so the
    // login screen never appears. Required mode: block until identity resolves.
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-muted">
                {t('app.loading')}
            </div>
        );
    }
    // Gate on the identity, not the authRequired flag: if me() fails (401 —
    // expired/missing session, or the backend requiring auth while this tab
    // holds no session) the app must show the login screen. authRequired only
    // says whether the BACKEND demands auth; a failed me() leaves it false,
    // which would otherwise render the whole dashboard unauthenticated
    // (every fetch 401s, modals show "Could not load your settings").
    if (!user) {
        return <LoginPage />;
    }
    return (
        <div className="flex min-h-screen bg-background text-on-background antialiased">
            <Sidebar />
            <main className="flex-1 ml-0 md:ml-[280px] w-full md:w-[calc(100%-280px)] flex flex-col min-h-screen">
                <TopNav />
                <Routes>
                    <Route path="/" element={<Overview />} />
                    <Route path="/yield-strategies" element={<YieldStrategies />} />
                    <Route path="/ai-agent-logs" element={<AIAgentLogs />} />
                    <Route path="/live-data" element={<LiveData />} />
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </main>
        </div>
    );
}

function App() {
    return (
        <ErrorBoundary>
            <I18nProvider>
                <ToastProvider>
                    <AuthProvider>
                        <SettingsProvider>
                            <WebSocketProvider>
                                <Router>
                                    <AppShell />
                                </Router>
                            </WebSocketProvider>
                        </SettingsProvider>
                    </AuthProvider>
                </ToastProvider>
            </I18nProvider>
        </ErrorBoundary>
    );
}

export default App;
