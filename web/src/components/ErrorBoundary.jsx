import PropTypes from 'prop-types';
import { Component } from 'react';
import { Alert, Button, Card } from 'react-bootstrap';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    if (typeof console !== 'undefined') {
      console.error('ErrorBoundary caught:', error, info);
    }
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    const { children, fallback } = this.props;
    if (!error) {
      return children;
    }
    if (fallback) {
      return fallback({ error, info, reset: this.reset });
    }
    return (
      <Card className="m-3">
        <Card.Body>
          <Card.Title className="text-danger">Something went wrong</Card.Title>
          <Alert variant="danger" className="mb-3">
            <strong>{error.name}:</strong> {error.message}
          </Alert>
          {info?.componentStack ? (
            <details>
              <summary className="text-muted small">Component stack</summary>
              <pre className="small mt-2 p-2 bg-body-tertiary" style={{ whiteSpace: 'pre-wrap' }}>
                {info.componentStack}
              </pre>
            </details>
          ) : null}
          <div className="d-flex gap-2 mt-3">
            <Button variant="primary" onClick={this.reset}>
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
            >
              Reload page
            </Button>
          </div>
        </Card.Body>
      </Card>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.func,
};
