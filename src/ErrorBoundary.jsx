// Last line of defense. Before this, a render-time throw anywhere in the tree
// white-screened the whole app — the user got nothing and no record was kept.
// Now a crash shows a small themed card and writes one row to the error sink.
//
// Deliberately minimal (no framer-motion, no icon libs beyond a bundled one, no
// hooks): it renders precisely when the app is already broken, so its own
// dependencies must be as close to nothing as possible. Themed via CSS tokens, so
// it's correct in light and dark without any theme wiring.
import { Component } from 'react';
import { logError } from './errlog';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    // The React component stack is the useful part for a render crash.
    logError(error, { kind: 'react', context: info?.componentStack || '' });
  }

  render() {
    if (!this.state.crashed) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--paper)', color: 'var(--text)', padding: 24,
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}>
        <div style={{
          maxWidth: 380, width: '100%', textAlign: 'center',
          background: 'var(--surface)', border: '1px solid var(--line)',
          borderRadius: 16, padding: '32px 24px',
          boxShadow: '0 8px 24px -8px rgba(0,0,0,0.18)',
        }}>
          <div style={{
            width: 48, height: 48, margin: '0 auto 16px', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--accent)', fontSize: 24, fontWeight: 700,
          }}>!</div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>Something broke</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 20px' }}>
            The dashboard hit an unexpected error and stopped. Reloading usually fixes it. If it keeps
            happening, let the team know.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              minHeight: 44, padding: '0 20px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', width: '100%',
            }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
