"use client";

import { useCallback, useEffect, useState } from "react";
import { Facebook, Key, Loader2, Plus, Trash2, X } from "lucide-react";

type Connection = { id: string; metaUserId: string | null; displayName: string | null; expiresAt: string | null; owned: boolean };

export default function MetaConnectionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/v1/meta/connection", { cache: "no-store" });
    const data = await response.json();
    setConnections(data.connections ?? []);
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);

  async function disconnect(connection: Connection) {
    if (!confirm(`¿Eliminar la conexión ${connection.displayName || connection.metaUserId || "Meta"}? Las campañas guardadas no se borran.`)) return;
    setBusy(connection.id);
    try {
      const response = await fetch(`/api/v1/meta/connection?connectionId=${encodeURIComponent(connection.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo eliminar la conexión");
      await load(); onSaved();
    } finally { setBusy(null); }
  }

  if (!open) return null;
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-xl rounded-xl border bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-2 border-b px-5 py-3"><Key className="h-4 w-4 text-brand-600" /><h3 className="flex-1 font-semibold text-slate-900">Conexiones con Meta</h3><button onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
      <div className="space-y-4 px-5 py-5">
        <p className="text-sm text-slate-600">Puedes vincular varias cuentas personales de Meta. El Hub reunirá todas sus cuentas publicitarias y usará automáticamente la autorización correcta para cada campaña.</p>
        {connections.length > 0 && <div className="divide-y rounded-lg border">{connections.map((connection) => <div key={connection.id} className="flex items-center gap-3 p-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-[#1877F2]"><Facebook className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{connection.displayName || "Cuenta Meta"}</div><div className="text-xs text-slate-500">ID {connection.metaUserId || "no disponible"}{connection.expiresAt ? ` · vence ${new Date(connection.expiresAt).toLocaleDateString("es-ES")}` : ""}</div></div>{connection.owned && <button onClick={() => void disconnect(connection)} disabled={busy === connection.id} title="Eliminar conexión" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50">{busy === connection.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}</div>)}</div>}
        <a href="/api/v1/admin/integrations/meta-login/connect?returnTo=meta-comments" className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1877F2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#166fe5]"><Plus className="h-4 w-4" /> Añadir otra cuenta de Meta</a>
        <div className="text-center text-[11px] text-slate-500">En Facebook, inicia sesión con la cuenta adicional y autoriza sus páginas y cuentas publicitarias.</div>
      </div>
      <div className="flex justify-end border-t bg-slate-50 px-5 py-3"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cerrar</button></div>
    </div>
  </div>;
}
