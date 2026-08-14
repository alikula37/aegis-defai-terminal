import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        NavLink: ({ to, children, className }) => (
            <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className}>{children}</a>
        ),
    };
});
vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({
        isSimulationRunning: false,
        setIsSimulationRunning: vi.fn(),
        hasData: false,
        setHasData: vi.fn(),
        setIsStartModalOpen: vi.fn(),
        setIsResumeModalOpen: vi.fn(),
        simulationStartTime: null,
    }),
}));
vi.mock('../lib/apiClient', () => ({
    apiFetch: vi.fn(async () => ({ ok: true })),
}));

describe('Sidebar render (E10 regression guard)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders without crashing (modals mount hidden)', () => {
        render(
            <MemoryRouter>
                <Sidebar />
            </MemoryRouter>,
        );
        expect(screen.getByText('AEGIS DeFAI')).toBeInTheDocument();
        expect(screen.getByText('Simulation Control')).toBeInTheDocument();
        // Docs/Support modals are mounted but closed
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});
