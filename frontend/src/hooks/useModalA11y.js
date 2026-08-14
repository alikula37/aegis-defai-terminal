// E10 — shared accessibility behavior for modals/drawers:
//   - role=dialog semantics are applied at the call site (aria-labelledby)
//   - Escape closes
//   - basic focus trap (Tab cycles within the modal; opening moves focus in,
//     closing restores it to the previously focused element)
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function useModalA11y({ isOpen = false, onClose = null, restoreFocus = true } = {}) {
    const modalRef = useRef(null);
    const lastFocused = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;

        if (restoreFocus) {
            lastFocused.current = document.activeElement;
        }
        const node = modalRef.current;
        if (node) {
            const focusables = node.querySelectorAll(FOCUSABLE);
            if (focusables.length > 0) focusables[0].focus();
        }

        const onKeyDown = (e) => {
            if (e.key === 'Escape' && onClose) {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key !== 'Tab' || !node) return;
            // offsetParent is always null in jsdom, so visibility is not used
            // to filter — disabled/aria-hidden elements are skipped instead.
            const focusables = [...node.querySelectorAll(FOCUSABLE)]
                .filter(el => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (restoreFocus && lastFocused.current && typeof lastFocused.current.focus === 'function') {
                lastFocused.current.focus();
            }
        };
    }, [isOpen, onClose, restoreFocus]);

    return { modalRef };
}
