import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import Overview from './pages/Overview';
import YieldStrategies from './pages/YieldStrategies';
import AIAgentLogs from './pages/AIAgentLogs';
import Settings from './pages/Settings';
import LiveData from './pages/LiveData';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { SettingsProvider } from './contexts/SettingsContext';
import ErrorBoundary from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <WebSocketProvider>
          <Router>
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
          </Router>
        </WebSocketProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

export default App;
