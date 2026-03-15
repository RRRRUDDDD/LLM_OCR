import { Component } from 'react';

/**
 * React Error Boundary — catches render errors and displays a fallback UI
 * instead of a white screen. Must be a class component (React limitation).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
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
          fontFamily: 'Roboto, sans-serif',
          color: '#1C1B1F',
          textAlign: 'center',
        }}>
          <span className="material-icons-round" style={{ fontSize: 64, color: '#B3261E', marginBottom: 16 }}>
            error_outline
          </span>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 500 }}>
            出错了
          </h2>
          <p style={{ margin: '0 0 24px', color: '#49454F', fontSize: 14 }}>
            {this.state.error?.message || '发生未知错误'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              height: 40,
              padding: '0 24px',
              borderRadius: 9999,
              border: 'none',
              background: '#6750A4',
              color: '#FFFFFF',
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
