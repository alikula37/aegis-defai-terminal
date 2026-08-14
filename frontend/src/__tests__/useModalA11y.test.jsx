import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useModalA11y } from '../hooks/useModalA11y';

function TestModal({ isOpen, onClose }) {
    const { modalRef } = useModalA11y({ isOpen, onClose });
    if (!isOpen) return null;
    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="t">
            <h2 id="t">Dialog</h2>
            <button>first</button>
            <button>last</button>
        </div>
    );
}

describe('useModalA11y (E10)', () => {
    it('moves focus into the dialog on open', () => {
        const onClose = vi.fn();
        render(<TestModal isOpen onClose={onClose} />);
        expect(document.activeElement).toBe(screen.getByText('first'));
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<TestModal isOpen onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on other keys', () => {
        const onClose = vi.fn();
        render(<TestModal isOpen onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'a' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('traps focus: Tab from the last element wraps to the first', () => {
        const onClose = vi.fn();
        render(<TestModal isOpen onClose={onClose} />);
        screen.getByText('last').focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByText('first'));
    });

    it('traps focus backwards with Shift+Tab from the first element', () => {
        const onClose = vi.fn();
        render(<TestModal isOpen onClose={onClose} />);
        screen.getByText('first').focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(screen.getByText('last'));
    });
});
