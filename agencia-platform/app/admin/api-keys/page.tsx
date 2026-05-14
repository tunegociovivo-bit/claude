"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Key, Plus, Copy, Check } from "lucide-react";

type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt?: string; createdAt: string };

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/api-keys");
    if (r.ok) {
      const data = await r.json();
      setKeys(data.items);
    }
    setLoading(false);
  }

  async function create() {
    if (!name.trim()) return;
    const r = await fetch("/api/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes: ["*"] })
    });
    if (r.ok) {
      const data = await r.json();
      setNewToken(data.token);
      setName("");
      load();
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="API keys"
        description="Genera tokens para integrar Agencia Hub con otras herramientas."
      />

      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="font-semibold mb-3">Crear nueva API key</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Make.com integración"
            className="flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={create}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Crear
          </button>
        </div>

        {newToken && (
          <div className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <div className="text-xs font-medium text-amber-900 mb-2">
              Guarda este token ahora — no volverá a mostrarse:
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-white border rounded text-xs font-mono break-all">{newToken}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newToken);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-2 rounded-md border bg-white hover:bg-slate-50"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-5 border-b flex items-center gap-2">
          <Key className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold">Tus API keys</h2>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Aún no hay keys. Crea una arriba.</div>
        ) : (
          <ul className="divide-y">
            {keys.map((k) => (
              <li key={k.id} className="p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="font-medium text-sm">{k.name}</div>
                  <code className="text-xs text-slate-500 font-mono">{k.prefix}…</code>
                </div>
                <div className="flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-slate-500 w-32 text-right">
                  {k.lastUsedAt
                    ? `Usada ${new Date(k.lastUsedAt).toLocaleDateString("es-ES")}`
                    : "Sin usar"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 text-xs text-slate-500">
        Documentación de la API: <a className="text-brand-600 underline" href="/api/openapi.json">/api/openapi.json</a> · Servidor MCP: <code className="font-mono">/api/mcp</code>
      </div>
    </div>
  );
}
