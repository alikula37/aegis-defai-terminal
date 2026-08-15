import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import SimulationResumeModal from '../components/SimulationResumeModal';
import DocsModal from '../components/DocsModal';


vi.mock('../contexts/ToastContext', () => ({
    useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
vi.mock('../lib/apiClient', () => ({
    fetchJson: vi.fn(async () => []),
    apiFetch: vi.fn(async () => ({ ok: true })),
}));

describe('Modal mount regression guard (E10)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('closed modals render null without crashing (imports resolve)', () => {
        const { container } = render(<SimulationResumeModal isOpen={false} onClose={vi.fn()} />);
        expect(container.innerHTML).toBe('');
        const docs = render(<DocsModal isOpen={false} onClose={vi.fn()} />);
        expect(docs.container.innerHTML).toBe('');
    });

    it('open resume modal has dialog semantics', () => {
        const { container } = render(<SimulationResumeModal isOpen onClose={vi.fn()} />);
        const dialog = container.querySelector('[role="dialog"]');
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('resume-modal-title');
        expect(container.querySelector('#resume-modal-title')).not.toBeNull();
    });
});
