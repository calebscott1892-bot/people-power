import React from 'react';
import { logError } from '@/utils/logError';
import ErrorState from '@/components/shared/ErrorState';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    try {
      logError(error, 'ErrorBoundary caught error', { componentStack: errorInfo?.componentStack });
    } catch {
      // Never allow the ErrorBoundary to throw while reporting.
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto p-6">
        <ErrorState
          error={this.state.error}
          onReload={() => window.location.reload()}
        />
      </div>
    );
  }
}
