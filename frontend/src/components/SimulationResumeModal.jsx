import { fetchJson } from '../lib/apiClient';
import { useState, useEffect } from 'react';

export default function SimulationResumeModal({ isOpen, onClose, onResume }) {
    const [simulations, setSimulations] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedSimId, setSelectedSimId] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            fetchJson('/api/simulations')
                .then(data => {
                    setSimulations(data);
                    if (data.length > 0) setSelectedSimId(data[0].id);
                })
                .catch(err => console.error("Failed to fetch simulations:", err))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen]);

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this simulation? All data will be lost.')) return;

        setIsLoading(true);
        try {
            const res = await apiFetch(`/api/simulation/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                const newSims = simulations.filter(s => s.id !== id);
                setSimulations(newSims);
                if (selectedSimId === id) {
                    setSelectedSimId(newSims.length > 0 ? newSims[0].id : null);
                }
            } else {
                const errData = await res.json();
                alert(`Failed to delete simulation: ${errData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to delete simulation:', error);
            alert(`Failed to delete simulation: ${error.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 max-w-md w-full shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="font-[Inter] text-[20px] font-bold text-on-surface">Resume Simulation</h2>
                    <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : simulations.length === 0 ? (
                    <p className="text-center text-on-surface-variant py-4 font-[JetBrains_Mono] text-[14px]">No simulations found.</p>
                ) : (
                    <div className="space-y-4 mb-6 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-outline-variant">
                        {simulations.map(sim => (
                            <label key={sim.id} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${selectedSimId === sim.id ? 'bg-primary/10 border-primary' : 'bg-surface-container-lowest border-outline-variant hover:border-outline'}`}>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="radio"
                                        name="simulation"
                                        value={sim.id}
                                        checked={selectedSimId === sim.id}
                                        onChange={() => setSelectedSimId(sim.id)}
                                        className="text-primary focus:ring-primary"
                                    />
                                    <div>
                                        <p className="font-[Inter] text-[14px] font-medium text-on-surface">{sim.name}</p>
                                        <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant">{new Date(sim.created_at).toLocaleString()}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`font-[JetBrains_Mono] text-[11px] font-bold px-2 py-1 rounded-full ${sim.status === 'ACTIVE' ? 'bg-success/20 text-success' : 'bg-outline-variant/30 text-on-surface-variant'}`}>
                                        {sim.status}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleDelete(sim.id);
                                        }}
                                        className="text-on-surface-variant hover:text-error transition-colors p-1 flex items-center justify-center rounded-full hover:bg-error/10"
                                        title="Delete Simulation"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                    </button>
                                </div>
                            </label>
                        ))}
                    </div>
                )}

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2 rounded-md font-[Inter] text-[14px] font-medium border border-outline-variant text-on-surface hover:bg-surface-container-highest transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onResume(selectedSimId)}
                        disabled={!selectedSimId || isLoading}
                        className="flex-1 py-2 rounded-md font-[Inter] text-[14px] font-medium bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Resume
                    </button>
                </div>
            </div>
        </div>
    );
}
