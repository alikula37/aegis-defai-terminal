// E10 — shared accessibility behavior for modals/drawers:
//   - role=dialog semantics are applied at the call site (aria-labelledby)
//   - Escape closes
//   - basic focus trap (Tab cycles within the modal; opening moves focus in,
//     closing restores it to the previously focused element)
import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function focusFirst(node) {
    const focusables = node.querySelectorAll(FOCUSABLE);
    if (focusables.length > 0) focusables[0].focus();
}

function restoreFocusTo(element) {
    if (element && typeof element.focus === 'function') element.focus();
}

// Tab-cycle within `node`; returns true when the event was handled.
function trapTab(node, event) {
    if (event.key !== 'Tab' || !node) return false;
    // offsetParent is always null in jsdom, so visibility is not used to
    // filter — disabled/aria-hidden elements are skipped instead.
    const focusables = [...node.querySelectorAll(FOCUSABLE)]
        .filter(el => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
    if (focusables.length === 0) return false;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
        return true;
    }
    return false;
}

export function useModalA11y({ isOpen = false, onClose = null, restoreFocus = true } = {}) {
    const modalRef = useRef(null);
    const lastFocused = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;

        if (restoreFocus) {
            lastFocused.current = document.activeElement;
        }
        const node = modalRef.current;
        if (node) focusFirst(node);

        const onKeyDown = (e) => {
            if (e.key === 'Escape' && onClose) {
                e.stopPropagation();
                onClose();
                return;
            }
            trapTab(node, e);
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            if (restoreFocus) restoreFocusTo(lastFocused.current);
        };
    }, [isOpen, onClose, restoreFocus]);

    return { modalRef };
}
