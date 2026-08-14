import { useState } from 'react';

export default function SupportModal({ isOpen, onClose }) {
    const [isSubmitted, setIsSubmitted] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        setIsSubmitted(true);
        setTimeout(() => {
            setIsSubmitted(false);
            onClose();
        }, 2000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">help</span>
                    Support
                </h2>

                {isSubmitted ? (
                    <div className="flex flex-col items-center justify-center py-8">
                        <span className="material-symbols-outlined text-success text-5xl mb-4">check_circle</span>
                        <p className="text-on-surface font-medium">Message sent successfully!</p>
                        <p className="text-on-surface-variant text-sm mt-2">We will get back to you soon.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Issue Type</label>
                            <select className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary">
                                <option>Bug Report</option>
                                <option>Feature Request</option>
                                <option>General Inquiry</option>
                            </select>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Message</label>
                            <textarea
                                required
                                rows="4"
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary resize-none"
                                placeholder="Describe your issue or request..."
                            ></textarea>
                        </div>
                        <button
                            type="submit"
                            className="w-full py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed"
                        >
                            Send Message
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
