import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(_error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
                    <div className="bg-gray-800 p-8 rounded-lg shadow-xl max-w-2xl w-full border border-red-500/30">
                        <h2 className="text-2xl font-bold text-error mb-4 flex items-center gap-2">
                            <span className="text-3xl">⚠️</span> Something went wrong.
                        </h2>
                        <p className="text-gray-300 mb-6">
                            The Aegis Terminal encountered an unexpected error. Please try refreshing the page.
                        </p>
                        <div className="bg-black/50 p-4 rounded overflow-auto max-h-64 mb-6 text-sm text-red-300 font-mono">
                            {this.state.error && this.state.error.toString()}
                            <br />
                            {this.state.errorInfo && this.state.errorInfo.componentStack}
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded transition-colors"
                        >
                            Reload Terminal
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
