"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Trash2, ExternalLink, Key } from "lucide-react";

/**
 * Modal de conexión con Meta. El user pega su Access Token (de larga
 * duración, sacado del Business Manager). El backend hace un ping a
 * graph.facebook.com/me para verificar que es válido antes de
 * guardarlo cifrado en BD.
 *
 * En Fase 2 sustituiremos esto por un botón "Conectar con Facebook"
 * que abre el flow OAuth2 oficial. Por ahora token manual.
 */
export default function MetaConnectionModal({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [token, setToken] = useState("");
  const [current, setCurrent] = useState<{ connected: boolean; metaUserId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setToken("");
    fetch("/api/v1/meta/connection")
      .then((r) => r.json())
      .then(setCurrent);
  }, [open]);

  async function save() {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/v1/meta/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Error");
      setSuccess(`Conexión OK con ${j.metaUserName ?? j.metaUserId}`);
      setToken("");
      onSaved();
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo guardar el token");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("¿Borrar la conexión con Meta? Las campañas guardadas no se borran, pero no podrás lanzarlas a Meta sin reconectar.")) return;
    setBusy(true);
    try {
      await fetch("/api/v1/meta/connection", { method: "DELETE" });
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <Key className="h-4 w-4 text-brand-600" />
          <h3 className="font-semibold text-slate-900 flex-1">Conexión con Meta</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {current?.connected && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
              Ya estás conectado (id: <code className="text-xs">{current.metaUserId}</code>).
              Puedes reemplazar el token o desconectar.
            </div>
          )}

          <div className="text-sm text-slate-600">
            Pega aquí tu <strong>Access Token</strong> de Meta.
            Lo generas en el Graph API Explorer:
          </div>
          <ol className="text-xs text-slate-600 list-decimal list-inside space-y-1 pl-2">
            <li>
              Abre{" "}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline inline-flex items-center gap-0.5"
              >
                Graph API Explorer
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
            <li>En "Meta App", selecciona tu app (o crea una).</li>
            <li>En "User or Page", elige <strong>"Get User Access Token"</strong>.</li>
            <li>
              Añade los permisos:{" "}
              <code className="text-[10px]">ads_management</code>,{" "}
              <code className="text-[10px]">leads_retrieval</code>,{" "}
              <code className="text-[10px]">pages_manage_ads</code>,{" "}
              <code className="text-[10px]">pages_read_engagement</code>.
            </li>
            <li>Pulsa "Generate Access Token", confirma los permisos y copia el token.</li>
            <li>Pégalo aquí abajo.</li>
          </ol>

          <div>
            <label className="text-xs font-medium text-slate-700 mb-1.5 block">
              Access Token
            </label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAxxxxxxxxxxxxxxxx..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Se cifra con AES-256-GCM antes de guardarse. Nunca se muestra de vuelta.
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              {success}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-2 bg-slate-50">
          {current?.connected ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Desconectar
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100">
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={busy || !token.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar conexión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
