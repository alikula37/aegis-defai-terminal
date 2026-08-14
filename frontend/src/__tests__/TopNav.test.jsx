import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopNav from '../components/TopNav';

const mockLocation = { pathname: '/yield-strategies' };
let mockWs;

vi.mock('react-router-dom', () => ({
    useLocation: () => mockLocation,
}));
vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => mockWs,
}));

describe('TopNav component', () => {
    beforeEach(() => {
        mockWs = {
            notifications: [],
            setNotifications: vi.fn(),
            simulationName: 'Test Sim',
            isSimulationRunning: false,
            executionStatus: { mode: 'simulation', ready: true },
        };
    });

    it('renders the current page title and date', () => {
        render(<TopNav />);
        expect(screen.getByText('Yield Strategies')).toBeInTheDocument();
        expect(screen.getByText(/Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul/)).toBeInTheDocument();
    });

    it('shows the simulation name badge while running', () => {
        mockWs.isSimulationRunning = true;
        render(<TopNav />);
        expect(screen.getByText('Test Sim')).toBeInTheDocument();
    });

    it('shows a Simulation execution badge by default', () => {
        render(<TopNav />);
        expect(screen.getByText('Simulation')).toBeInTheDocument();
    });

    it('shows a ready Onchain badge with the short wallet address', () => {
        mockWs.executionStatus = {
            mode: 'onchain',
            ready: true,
            chainId: 11155111,
            signerAddress: '0x9767de120c29ca81Be56be02fC662b0513282435',
        };
        render(<TopNav />);
        expect(screen.getByText(/Onchain · 0x9767…2435/)).toBeInTheDocument();
    });

    it('shows a not-ready Onchain badge when no wallet is configured', () => {
        mockWs.executionStatus = { mode: 'onchain', ready: false, chainId: 11155111, signerAddress: null };
        render(<TopNav />);
        expect(screen.getByText(/Onchain · no wallet/)).toBeInTheDocument();
    });

    it('does not render a dead search input or account button', () => {
        render(<TopNav />);
        expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
        expect(screen.queryByTitle('account_circle')).not.toBeInTheDocument();
    });

    it('keeps the wallet button disabled until Phase 2', () => {
        render(<TopNav />);
        const wallet = screen.getByRole('button', { name: /Connect Wallet/i });
        expect(wallet).toBeDisabled();
        expect(wallet.title).toContain('Phase 2');
    });

    it('toggles the notifications panel and clears them', () => {
        mockWs.notifications = [{ message: 'HF is low', timestamp: '2026-08-13T12:00:00Z', type: 'error' }];
        render(<TopNav />);
        fireEvent.click(screen.getByLabelText('Notifications'));
        expect(screen.getByText('HF is low')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Clear All'));
        expect(mockWs.setNotifications).toHaveBeenCalledWith([]);
    });

    it('shows empty state when no notifications', () => {
        render(<TopNav />);
        fireEvent.click(screen.getByLabelText('Notifications'));
        expect(screen.getByText('No new notifications')).toBeInTheDocument();
    });
});
