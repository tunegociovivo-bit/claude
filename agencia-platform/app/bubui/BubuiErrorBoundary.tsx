"use client";

/**
 * Error Boundary global del scope /bubui (web).
 *
 * Reemplaza la pantalla blanca "Application error: a client-side exception
 * has occurred" de Next.js production por una tarjeta con el mensaje real
 * y un botón "Reintentar". Útil para diagnosticar in-the-wild sin tener que
 * pedirle al usuario que abra la consola del navegador.
 */

import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null; info: string };

export class BubuiErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: "" };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ error, info: info.componentStack ?? "" });
  }

  reset = () => this.setState({ error: null, info: "" });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-lg font-bold text-rose-900 mb-2">Se produjo un error</h2>
          <p className="text-sm text-rose-900/85 mb-3">
            {String(this.state.error?.name)}: {String(this.state.error?.message)}
          </p>
          {this.state.error?.stack ? (
            <pre className="text-[11px] text-rose-900/70 bg-white rounded p-2 overflow-x-auto whitespace-pre-wrap break-words mb-3">
              {String(this.state.error.stack).slice(0, 2000)}
            </pre>
          ) : null}
          {this.state.info ? (
            <pre className="text-[11px] text-rose-900/55 bg-white rounded p-2 overflow-x-auto whitespace-pre-wrap break-words mb-3">
              {this.state.info.slice(0, 1500)}
            </pre>
          ) : null}
          <button
            onClick={this.reset}
            className="bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-full px-5 py-2"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
