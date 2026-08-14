// E10 — mobile navigation drawer (visible below md). Desktop keeps the fixed
// sidebar; this overlay gives mobile users the same nav + a11y (role=dialog,
// Esc close, focus trap, backdrop click).
import { NavLink } from 'react-router-dom';
import { useModalA11y } from '../hooks/useModalA11y';
import { navItems } from './Sidebar';

export default function MobileNav({ isOpen, onClose }) {
    const { modalRef } = useModalA11y({ isOpen, onClose });

    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="mobile-nav-title" className="md:hidden fixed inset-0 z-[90]">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true"></div>
            <div className="absolute left-0 top-0 h-full w-[280px] bg-surface-container-low border-r border-outline-variant flex flex-col p-4 shadow-2xl">
                <div className="mb-6 px-1 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
                            <span className="material-symbols-outlined text-on-primary-container text-sm">terminal</span>
                        </div>
                        <h1 id="mobile-nav-title" className="font-[Inter] text-[20px] font-bold text-primary tracking-tight">AEGIS DeFAI</h1>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close navigation"
                        className="text-on-surface-variant hover:text-on-surface p-1.5 rounded-lg hover:bg-surface-variant transition-colors"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <nav className="flex-1 flex flex-col gap-1" aria-label="Main navigation">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.label}
                            to={item.to}
                            end={item.to === '/'}
                            onClick={onClose}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${isActive
                                    ? 'text-primary font-bold bg-surface-variant border-r-2 border-primary'
                                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'
                                }`
                            }
                        >
                            <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                            <span className="font-[Inter] text-[16px] leading-[24px]">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                <p className="mt-auto text-[11px] text-on-surface-variant font-[JetBrains_Mono] text-center">
                    Aegis DeFAI Terminal
                </p>
            </div>
        </div>
    );
}
