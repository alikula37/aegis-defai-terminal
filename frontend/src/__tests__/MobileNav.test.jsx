import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileNav from '../components/MobileNav';
vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = { t: (k) => en[k] ?? k, lang: 'en', setLang: () => {} };
    return { useI18n: () => api };
});

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({}),
}));
vi.mock('../lib/apiClient', () => ({
    apiFetch: vi.fn(async () => ({ ok: true })),
}));

function renderNav(props = {}) {
    return render(
        <MemoryRouter>
            <MobileNav isOpen onClose={vi.fn()} {...props} />
        </MemoryRouter>,
    );
}

describe('MobileNav (E10)', () => {
    it('renders null when closed', () => {
        const { container } = render(
            <MemoryRouter>
                <MobileNav isOpen={false} onClose={vi.fn()} />
            </MemoryRouter>,
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders all nav links with dialog semantics', () => {
        renderNav();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'mobile-nav-title');
        for (const label of ['Overview', 'Yield Strategies', 'Live Data', 'AI Agent Logs', 'Settings']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        expect(screen.getByLabelText('Close')).toBeInTheDocument();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        renderNav({ onClose });
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('closes when a nav link is clicked', () => {
        const onClose = vi.fn();
        renderNav({ onClose });
        fireEvent.click(screen.getByText('Settings'));
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on backdrop click', () => {
        const onClose = vi.fn();
        renderNav({ onClose });
        const backdrop = document.querySelector('div.md\\:hidden div.absolute');
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalled();
    });
});
