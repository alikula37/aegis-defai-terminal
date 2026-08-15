import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../contexts/ToastContext';

function Probe() {
    const toast = useToast();
    return (
        <div>
            <button onClick={() => toast.error('boom')}>err</button>
            <button onClick={() => toast.success('saved ok')}>ok</button>
        </div>
    );
}

describe('Toast system', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows toasts and dismisses them automatically', async () => {
        render(
            <ToastProvider>
                <Probe />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'err' }));
        expect(screen.getByText('boom')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'ok' }));
        expect(screen.getByText('saved ok')).toBeTruthy();
        // Auto-dismiss after the 5s window.
        act(() => { vi.advanceTimersByTime(5200); });
        expect(screen.queryByText('boom')).toBeNull();
        expect(screen.queryByText('saved ok')).toBeNull();
    });

    it('dismisses individually via the close button', () => {
        render(
            <ToastProvider>
                <Probe />
            </ToastProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'err' }));
        fireEvent.click(screen.getAllByRole('button', { name: /Dismiss notification/i })[0]);
        expect(screen.queryByText('boom')).toBeNull();
    });
});
