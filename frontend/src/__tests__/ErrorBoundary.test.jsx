import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

// A component that throws an error for testing
const ProblemChild = () => {
    throw new Error('Test error');
};

describe('ErrorBoundary Component', () => {
    it('should render children when there is no error', () => {
        render(
            <ErrorBoundary>
                <div data-testid="safe-child">Safe Content</div>
            </ErrorBoundary>
        );
        expect(screen.getByTestId('safe-child')).toBeInTheDocument();
    });

    it('should catch errors and display the fallback UI', () => {
        // Suppress console.error for this test to keep output clean
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        render(
            <ErrorBoundary>
                <ProblemChild />
            </ErrorBoundary>
        );

        expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
        expect(screen.getByText(/Test error/i)).toBeInTheDocument();

        consoleSpy.mockRestore();
    });
});
