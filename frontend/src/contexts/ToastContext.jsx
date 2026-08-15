import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';
import { Toasts } from '../components/Toasts';

// Lightweight toast notifications: themed replacement for window.alert().
// The provider renders the stacked toasts (see Toasts.jsx); any component or
// context under it can call toast.error/success/info. Auto-dismiss after 5s.

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const timers = useRef(new Map());

    const dismiss = useCallback((id) => {
        const t = timers.current.get(id);
        if (t) { clearTimeout(t); timers.current.delete(id); }
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const push = useCallback((type, message) => {
        const id = nextId++;
        setToasts(prev => [...prev.slice(-4), { id, type, message }]);
        const timer = setTimeout(() => dismiss(id), 5000);
        timers.current.set(id, timer);
    }, [dismiss]);

    const toast = useMemo(() => ({
        error: (message) => push('error', message),
        success: (message) => push('success', message),
        info: (message) => push('info', message),
    }), [push]);

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <Toasts toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
}

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
}
