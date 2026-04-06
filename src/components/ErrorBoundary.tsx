import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { uiLogger } from '../utils/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    uiLogger.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          fontFamily: 'var(--md-font, Roboto, sans-serif)',
          color: 'var(--md-on-surface, #1C1B1F)',
          background: 'var(--md-background, #FFFBFE)',
          textAlign: 'center',
        }}>
          <span className="material-icons-round" style={{ fontSize: 64, color: 'var(--md-error, #B3261E)', marginBottom: 16 }}>
            error_outline
          </span>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 500 }}>
            出错了
          </h2>
          <p style={{ margin: '0 0 24px', color: 'var(--md-on-surface-variant, #49454F)', fontSize: 14 }}>
            {this.state.error?.message || '发生未知错误'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              height: 40,
              padding: '0 24px',
              borderRadius: 9999,
              border: 'none',
              background: 'var(--md-primary, #6750A4)',
              color: 'var(--md-on-primary, #FFFFFF)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
