import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog';

vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = { t: (k, vars) => { let s = en[k] ?? k; if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => vars[n] !== undefined ? String(vars[n]) : m); return s; }, lang: 'en', setLang: () => {} };
    return { useI18n: () => api };
});
vi.mock('../hooks/useModalA11y', () => ({
    useModalA11y: () => ({ modalRef: { current: null } }),
}));

describe('ConfirmDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when closed', () => {
        const { container } = render(<ConfirmDialog isOpen={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });

    it('shows title + message and calls onConfirm on confirm', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(
            <ConfirmDialog
                isOpen
                title="Delete this?"
                message="It will be gone forever."
                confirmLabel="Delete"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        expect(screen.getByText('Delete this?')).toBeTruthy();
        expect(screen.getByText('It will be gone forever.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onConfirm).toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('calls onCancel on cancel', () => {
        const onCancel = vi.fn();
        render(<ConfirmDialog isOpen onConfirm={vi.fn()} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
        expect(onCancel).toHaveBeenCalled();
    });
});
