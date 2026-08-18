"use client";

import { useEffect, useState } from "react";
import { Facebook, Key, Trash2, X } from "lucide-react";

export default function MetaConnectionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState<{ connected: boolean; metaUserId?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/meta/connection").then((response) => response.json()).then(setCurrent);
  }, [open]);

  async function disconnect() {
    if (!confirm("¿Borrar la conexión con Meta? Las campañas guardadas no se borran.")) return;
    setBusy(true);
    try {
      await fetch("/api/v1/meta/connection", { method: "DELETE" });
      onSaved(); onClose();
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-lg rounded-xl border bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b px-5 py-3"><Key className="h-4 w-4 text-brand-600" /><h3 className="flex-1 font-semibold text-slate-900">Conexión con Meta</h3><button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
      <div className="space-y-4 px-5 py-5">
        {current?.connected && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Hay una autorización guardada (id: <code className="text-xs">{current.metaUserId}</code>). Puedes renovarla iniciando sesión de nuevo.</div>}
        <p className="text-sm text-slate-600">Inicia sesión en Meta y autoriza las páginas y cuentas publicitarias que quieras gestionar. El Hub guardará la autorización cifrada y renovará la conexión automáticamente.</p>
        <a href="/api/v1/admin/integrations/meta-login/connect?returnTo=meta-comments" className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#166fe5]"><Facebook className="h-4 w-4" />{current?.connected ? "Volver a autorizar con Meta" : "Continuar con Facebook"}</a>
        <div className="text-center text-[11px] text-slate-500">Como en Make: no tendrás que copiar ni renovar tokens manualmente.</div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t bg-slate-50 px-5 py-3">
        {current?.connected ? <button onClick={disconnect} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Desconectar</button> : <span />}
        <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cerrar</button>
      </div>
    </div>
  </div>;
}
