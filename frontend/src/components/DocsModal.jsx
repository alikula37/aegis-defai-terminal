import { useModalA11y } from '../hooks/useModalA11y';

export default function DocsModal({ isOpen, onClose }) {
    const { modalRef } = useModalA11y({ isOpen, onClose });
    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="docs-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-2xl shadow-2xl relative max-h-[80vh] flex flex-col">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 id="docs-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">description</span>
                    Documentation & Changelog
                </h2>

                <div className="overflow-y-auto pr-2 space-y-6 text-on-surface-variant text-sm font-[Inter]">
                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">Aegis DeFAI Terminal</h3>
                        <p className="mb-2">
                            Aegis is an autonomous DeFi portfolio manager AI agent specialized in looping/leveraged yield strategies and flash loan rebalancing on Ethereum L2s.
                        </p>
                    </section>

                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">Recent Updates (Changelog)</h3>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>v1.2.0:</strong> Added TVL History chart and dynamic PnL calculations.</li>
                            <li><strong>v1.1.0:</strong> Integrated OpenRouter API quota error notifications in the header.</li>
                            <li><strong>v1.0.5:</strong> Fixed Health Factor calculation bug and reset simulation logic.</li>
                            <li><strong>v1.0.0:</strong> Initial release with real-time DeFiLlama oracle integration and Morpho Blue flash loan simulation.</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">System Architecture</h3>
                        <p className="mb-2">
                            The system consists of a React frontend (Vite + Tailwind CSS v4) and a Node.js backend. Communication is handled via REST API and WebSockets for real-time portfolio and agent log updates.
                        </p>
                        <p>
                            The AI agent uses <strong>Claude 3.5 Sonnet</strong> for critical rebalance decisions and <strong>Llama 3.1 70B</strong> for routine market scanning, optimizing API costs.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
