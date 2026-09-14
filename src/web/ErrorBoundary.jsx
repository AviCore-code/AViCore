import { Component } from "react";

// Catches a render/runtime crash in a page so it shows the actual error text
// instead of silently blanking the whole content area. Also logs the full
// error + stack to the browser console for debugging.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("AdminWebApp page crashed:", error, info);
  }
  reset = () => this.setState({ error: null, info: null });
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "24px", color: "#e2e8f0" }}>
          <h2 style={{ color: "#f87171", marginTop: 0 }}>Something went wrong on this page</h2>
          <p style={{ color: "#94a3b8" }}>The details below help pinpoint the cause. Try Reload; if it keeps happening, send this text.</p>
          <pre style={{ whiteSpace: "pre-wrap", background: "rgba(15,23,42,.7)", border: "1px solid rgba(239,68,68,.3)", borderRadius: "8px", padding: "12px", fontSize: "12px", color: "#fca5a5", overflow: "auto" }}>
            {String(this.state.error && (this.state.error.stack || this.state.error.message || this.state.error))}
          </pre>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={this.reset} style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid #334155", background: "transparent", color: "#cbd5e1", cursor: "pointer" }}>Try again</button>
            <button onClick={() => window.location.reload()} style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid #1677ff", background: "#1677ff", color: "#fff", cursor: "pointer" }}>Reload page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
