"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Loader2, Eye, EyeOff, Copy, Check, KeyRound, ShieldAlert } from "lucide-react";

type Secret = { id: string; label: string; category: string; present: boolean; masked: string };
type Data = { count: number; byCategory: Record<string, Secret[]> };

export default function SecretsVaultClient() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  // Valores revelados en memoria (id → plaintext). Se limpian al salir.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Modal de re-autenticación
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/secrets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  async function doReveal() {
    if (!pendingId || !password) return;
    setRevealing(true);
    setAuthError(null);
    try {
      const r = await fetch("/api/v1/admin/secrets/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingId, password })
      });
      const d = await r.json();
      if (!r.ok) {
        setAuthError(d?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setRevealed((prev) => ({ ...prev, [pendingId]: d.value }));
      setPendingId(null);
      setPassword("");
    } finally {
      setRevealing(false);
    }
  }

  function hide(id: string) {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {}
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Bóveda de credenciales"
        description="Todas las APIs y tokens del workspace, cifrados. Revélalos con tu contraseña para copiarlos y usarlos en otro sitio."
      />

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-5 flex items-start gap-2 text-xs text-amber-900">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Estos valores son secretos. Cada vez que reveles uno se registra en la auditoría (quién y cuándo).
          No los compartas por chat ni email; cópialos y pégalos directamente donde los necesites.
        </span>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : !data || data.count === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500">
          No hay credenciales guardadas todavía.
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(data.byCategory).map(([category, secrets]) => (
            <div key={category} className="bg-white rounded-xl border overflow-hidden">
              <div className="px-5 py-2.5 border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {category}
              </div>
              <div className="divide-y">
                {secrets.map((s) => {
                  const value = revealed[s.id];
                  return (
                    <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                      <KeyRound className="h-4 w-4 text-slate-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{s.label}</div>
                        <div className="font-mono text-xs text-slate-500 break-all">
                          {value ?? s.masked}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {value ? (
                          <>
                            <button
                              onClick={() => copy(s.id, value)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-brand-600 hover:bg-brand-50"
                              title="Copiar"
                            >
                              {copiedId === s.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5" /> Copiado
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" /> Copiar
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => hide(s.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100"
                              title="Ocultar"
                            >
                              <EyeOff className="h-3.5 w-3.5" /> Ocultar
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              setPendingId(s.id);
                              setPassword("");
                              setAuthError(null);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                            title="Ver valor"
                          >
                            <Eye className="h-3.5 w-3.5" /> Ver
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!pendingId}
        onClose={() => {
          setPendingId(null);
          setPassword("");
        }}
        title="Confirma tu contraseña"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setPendingId(null);
                setPassword("");
              }}
              className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={doReveal}
              disabled={revealing || !password}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {revealing && <Loader2 className="h-4 w-4 animate-spin" />}
              Revelar
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 mb-3">
          Por seguridad, introduce tu contraseña para revelar este secreto. Quedará registrado en la auditoría.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doReveal();
          }}
          placeholder="Tu contraseña"
          className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {authError && <p className="mt-2 text-xs text-rose-600">{authError}</p>}
      </Modal>
    </div>
  );
}
