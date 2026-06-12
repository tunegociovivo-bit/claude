"use client";

import { Component, type ReactNode } from "react";

/**
 * Barrera de error local: captura un crash de render de su contenido y muestra
 * el MOTIVO en pantalla en vez de tumbar toda la sección (el genérico "Algo ha
 * fallado"). Pensado para envolver piezas concretas (p.ej. el modal de Ajustes
 * de Leads) y poder diagnosticar el error real sin abrir la consola.
 */
export class SectionBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[SectionBoundary]", this.props.label ?? "", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700 space-y-1">
            <div className="font-semibold">Se ha producido un error{this.props.label ? ` en ${this.props.label}` : ""}.</div>
            <div className="text-[12px] font-mono break-words">{this.state.error.message || String(this.state.error)}</div>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
