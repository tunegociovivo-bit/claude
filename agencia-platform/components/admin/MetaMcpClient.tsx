"use client";

import { useEffect, useState } from "react";

export default function MetaMcpClient() {
  const [token, setToken] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/v1/admin/integrations/meta-mcp");
      const d = await r.json();
      setConfigured(!!d.configured);
    } catch {
      setConfigured(false);
    }
  }
  useEffect(() => {
    load();
    // Mensajes del callback OAuth.
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) setMsg("✓ Conectado con Meta correctamente.");
    if (p.get("error")) setMsg(`Error al conectar: ${p.get("error")}`);
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/integrations/meta-mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "Error al guardar");
      setMsg("✓ Token guardado.");
      setToken("");
      setConfigured(true);
    } catch (e: any) {
      setMsg(`Error: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestOut(null);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/integrations/meta-mcp", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        setTestOut(`❌ No funcionó: ${d?.error ?? d?.error?.message ?? "error"}`);
      } else {
        setTestOut(`✅ Funciona. Respuesta del conector:\n\n${d.result ?? ""}`);
      }
    } catch (e: any) {
      setTestOut(`❌ Error: ${e?.message ?? e}`);
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!confirm("¿Borrar el token del MCP de Meta?")) return;
    await fetch("/api/v1/admin/integrations/meta-mcp", { method: "DELETE" });
    setConfigured(false);
    setMsg("Token borrado.");
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Conector Meta (MCP)</h1>
      <p className="text-sm text-slate-600">
        Acceso total a Meta Ads vía el MCP oficial de Meta (autenticado como el usuario). Sonia lo usa
        automáticamente cuando el token permanente no tiene permisos sobre una cuenta.
      </p>
      <div className="text-sm">
        Estado:{" "}
        {configured === null ? (
          "comprobando…"
        ) : configured ? (
          <span className="text-emerald-700 font-medium">conectado</span>
        ) : (
          <span className="text-amber-700 font-medium">sin conectar</span>
        )}
      </div>

      <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-4 space-y-2">
        <div className="text-sm font-medium text-slate-800">✅ Recomendado — Conectar con Facebook (acceso total)</div>
        <p className="text-xs text-slate-600">
          Inicia sesión en Facebook una vez. El Hub obtiene un token de usuario con acceso a TODAS tus
          cuentas (las que ves tú), lo usa en todo (campañas, leads, Sonia) y lo renueva solo antes de
          caducar. Requiere una App de Facebook (META_APP_ID / META_APP_SECRET en Railway).
        </p>
        <a
          href="/api/v1/admin/integrations/meta-login/connect"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
        >
          Conectar con Facebook (acceso total)
        </a>
      </div>

      <details className="rounded-lg border p-3">
        <summary className="text-sm text-slate-700 cursor-pointer">
          Experimental: conector MCP de Meta (registro automático — Meta lo tiene desactivado)
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-600">
            Conexión vía el MCP oficial de Meta. Meta no permite el registro automático de apps de
            terceros, así que esto solo funciona si defines META_APP_ID/META_APP_SECRET.
          </p>
          <a
            href="/api/v1/admin/integrations/meta-mcp/connect"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium"
          >
            {configured ? "Reconectar (MCP)" : "Conectar (MCP)"}
          </a>
        </div>
      </details>

      <div className="flex gap-2">
        <button
          onClick={test}
          disabled={testing || !configured}
          className="px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50"
        >
          {testing ? "Probando…" : "Probar conexión"}
        </button>
        {configured && (
          <button onClick={remove} className="px-3 py-2 rounded-lg border text-sm text-rose-600">
            Desconectar
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
      {testOut && (
        <pre className="text-xs bg-slate-50 border rounded-lg p-3 whitespace-pre-wrap">{testOut}</pre>
      )}

      <details className="rounded-lg border p-3">
        <summary className="text-sm text-slate-700 cursor-pointer">Avanzado: pegar un token a mano</summary>
        <div className="space-y-2 mt-3">
          <label className="block text-xs font-medium text-slate-700">Token de autorización del MCP de Meta</label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Pega aquí el token (de larga duración) de Meta…"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
          />
          <button
            onClick={save}
            disabled={saving || token.trim().length < 20}
            className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar token"}
          </button>
        </div>
      </details>
    </div>
  );
}
