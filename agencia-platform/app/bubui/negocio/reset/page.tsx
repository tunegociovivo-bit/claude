"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="max-w-md mx-auto px-4 py-12 text-center text-black/50">Cargando…</main>}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/bubui/business/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      // Guarda sesión y entra directo al panel.
      try {
        localStorage.setItem(
          "bubui.business",
          JSON.stringify({ businessId: j.businessId, name: j.name, token: j.token })
        );
      } catch {}
      setDone(true);
      setTimeout(() => router.push("/bubui/negocio"), 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6 bubui-fade-up">
        <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bubui</h1>
        <p className="text-black/60 text-sm mt-3">Nueva contraseña</p>
      </div>
      {!token ? (
        <div className="bubui-card p-6 text-center text-sm">
          Enlace no válido. Pide uno nuevo desde{" "}
          <a href="/bubui/negocio" className="text-pink-600 font-semibold">¿Olvidaste tu contraseña?</a>
        </div>
      ) : done ? (
        <div className="bubui-card p-6 text-center text-sm space-y-2">
          <p>✅ Contraseña actualizada. Entrando a tu panel…</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 bubui-card p-6 bubui-fade-up bubui-fade-up-1">
          <input
            type="password"
            placeholder="Nueva contraseña (mín. 8 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bubui-input"
          />
          <input
            type="password"
            placeholder="Repite la contraseña"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="bubui-input"
          />
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button type="submit" disabled={busy} className="bubui-btn w-full">
            {busy ? "Guardando…" : "Guardar contraseña"}
          </button>
        </form>
      )}
    </main>
  );
}
