import React from 'react';
import { logError } from '@/utils/logError';

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

    const showDetails = import.meta?.env?.DEV;
    const safeMessage = this.state.error?.message || this.state.error || 'Unknown error';

    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
          <div className="font-black text-slate-900 text-lg mb-2">Something went wrong</div>
          <div className="text-sm text-slate-600">
            This page hit an error while we’re migrating off the old backend. Try refreshing.
          </div>
          {showDetails ? (
            <pre className="mt-4 text-xs overflow-auto whitespace-pre-wrap text-slate-500">
              {String(safeMessage)}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }
}
