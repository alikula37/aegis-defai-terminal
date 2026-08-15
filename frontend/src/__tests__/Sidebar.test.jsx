import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
const clearSimulationData = vi.fn();
vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({
        isSimulationRunning: false,
        setIsSimulationRunning: vi.fn(),
        hasData: false,
        setHasData: vi.fn(),
        setIsStartModalOpen: vi.fn(),
        setIsResumeModalOpen: vi.fn(),
        simulationStartTime: null,
        clearSimulationData,
    }),
}));
const apiFetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
vi.mock('../lib/apiClient', () => ({
    apiFetch: (...args) => apiFetch(...args),
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

    it('shows a delete action when a past simulation exists', async () => {
        apiFetch.mockImplementation(async (url) => {
            if (url === '/api/simulations') return { ok: true, json: async () => [{ id: 7, name: 'sim_x' }] };
            return { ok: true, json: async () => ({}) };
        });
        render(
            <MemoryRouter>
                <Sidebar />
            </MemoryRouter>,
        );
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Delete last simulation/i })).toBeTruthy();
        });
    });

    it('deleting calls the API with the latest id and clears the UI data', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        apiFetch.mockImplementation(async (url) => {
            if (url === '/api/simulations') return { ok: true, json: async () => [{ id: 7, name: 'sim_x' }] };
            if (url === '/api/simulation/7') return { ok: true, json: async () => ({ success: true }) };
            return { ok: true, json: async () => ({}) };
        });
        render(
            <MemoryRouter>
                <Sidebar />
            </MemoryRouter>,
        );
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Delete last simulation/i })).toBeTruthy();
        });
        fireEvent.click(screen.getByRole('button', { name: /Delete last simulation/i }));
        await waitFor(() => {
            expect(apiFetch).toHaveBeenCalledWith('/api/simulation/7', { method: 'DELETE' });
        });
        expect(clearSimulationData).toHaveBeenCalled();
        confirmSpy.mockRestore();
    });
});
