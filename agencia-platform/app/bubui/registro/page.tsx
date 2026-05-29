"use client";

import { useState } from "react";

const CATEGORIES = [
  "Restauración",
  "Peluquería / Barbería",
  "Estética / Spa",
  "Gimnasio / Fitness",
  "Nutrición / Salud",
  "Tienda de moda",
  "Tienda de regalos",
  "Café / Bar",
  "Joyería",
  "Floristería",
  "Otro"
];

export default function RegistroNegocio() {
  const [form, setForm] = useState({
    name: "",
    category: CATEGORIES[0],
    address: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerPassword: "",
    defaultDiscountPct: 5,
    crossDiscountPct: 8
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ businessId: string; qrPngUrl: string; scanUrl: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/bubui/business/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setResult(j);
    } catch (e: any) {
      setError(e?.message ?? "Error de red");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-6 bubui-fade-up">
          <span className="bubui-eyebrow">✓ Listo</span>
          <h1 className="text-3xl sm:text-4xl font-black mt-4 tracking-tight">
            ¡Bienvenido a <span className="bubui-wordmark" style={{ fontSize: "1em", verticalAlign: "-0.05em" }}>bubui</span>!
          </h1>
          <p className="text-black/60 mt-3 text-sm">
            Tu negocio está dado de alta. Elige un estilo de cartel, imprime el PNG y ponlo en la caja.
            Cada escaneo te hace más visible en la red.
          </p>
        </div>
        <PosterPicker businessId={result.businessId} qrPngUrl={result.qrPngUrl} scanUrl={result.scanUrl} />
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-8 bubui-fade-up">
        <span className="bubui-eyebrow">Para negocios</span>
        <h1 className="bubui-wordmark mx-auto justify-center mt-4" style={{ fontSize: 64 }}>bubui</h1>
        <p className="text-black mt-3 font-bold tracking-tight">
          Ahorra. Disfruta. <span style={{ color: "#EC4899" }}>Apoya local.</span>
        </p>
        <h2 className="text-2xl sm:text-3xl font-black mt-6 tracking-tight">Alta de negocio</h2>
        <p className="text-black/60 text-sm mt-2">
          Gratis. 2 minutos. Saldrás con tu QR listo para imprimir.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4 bg-white border rounded-2xl p-6 shadow-sm">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nombre del negocio" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              className="input"
              placeholder="Ej: Spa Bambú"
            />
          </Field>
          <Field label="Categoría" required>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="input"
            >
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Dirección (calle y número, Benalmádena)">
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="input"
            placeholder="Av. de la Constitución 12"
          />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Tu nombre" required>
            <input
              value={form.ownerName}
              onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
              required
              className="input"
            />
          </Field>
          <Field label="Tu teléfono">
            <input
              value={form.ownerPhone}
              onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })}
              className="input"
            />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Email" required>
            <input
              type="email"
              value={form.ownerEmail}
              onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
              required
              className="input"
            />
          </Field>
          <Field label="Contraseña (8+ chars)" required>
            <input
              type="password"
              value={form.ownerPassword}
              onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
              required
              minLength={8}
              className="input"
            />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="% a clientes que escanean tu QR">
            <input
              type="number"
              min={3}
              max={30}
              value={form.defaultDiscountPct}
              onChange={(e) => setForm({ ...form, defaultDiscountPct: Number(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="% a clientes con cupón cruzado de otros negocios">
            <input
              type="number"
              min={3}
              max={30}
              value={form.crossDiscountPct}
              onChange={(e) => setForm({ ...form, crossDiscountPct: Number(e.target.value) })}
              className="input"
            />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={saving} className="bubui-btn w-full">
          {saving ? "Creando…" : "Crear cuenta y generar mi QR"}
        </button>
      </form>
      <style jsx>{`
        :global(.input) {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          background: #fff;
          font-size: 0.9rem;
        }
        :global(.input:focus) {
          outline: 2px solid #d97706;
          outline-offset: 1px;
        }
      `}</style>
    </main>
  );
}

function PosterPicker({ businessId, qrPngUrl, scanUrl }: { businessId: string; qrPngUrl: string; scanUrl: string }) {
  const [style, setStyle] = useState<"cosy" | "bold" | "fresh">("cosy");
  const posterUrl = `/api/bubui/business/${businessId}/poster.png?style=${style}&t=${style}`;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white border p-4 shadow-sm">
        <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
          {(["cosy", "bold", "fresh"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={
                "px-3 py-1.5 rounded-full text-xs font-medium border " +
                (style === s ? "bg-pink-600 text-white border-pink-600" : "bg-white border-slate-200 text-slate-600")
              }
            >
              {s === "cosy" ? "🌅 Cálido" : s === "bold" ? "🎯 Atrevido" : "🌿 Fresco"}
            </button>
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={style}
          src={posterUrl}
          alt="Cartel del negocio"
          className="w-full rounded-xl border bg-slate-50"
        />
        <div className="flex items-center justify-between gap-2 mt-4">
          <a
            href={posterUrl}
            download={`bubui-cartel-${style}.png`}
            className="flex-1 text-center inline-block px-4 py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white text-sm font-medium"
          >
            Descargar cartel ({style})
          </a>
          <a
            href={qrPngUrl}
            download="bubui-qr.png"
            className="flex-1 text-center inline-block px-4 py-2 rounded-full border bg-white hover:bg-slate-50 text-sm"
          >
            Solo QR
          </a>
        </div>
      </div>
      <details className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600">
        <summary className="cursor-pointer">URL del QR ↗</summary>
        <p className="font-mono break-all mt-2">{scanUrl}</p>
      </details>
      <a
        href="/bubui/negocio"
        className="block text-center text-sm text-pink-600 hover:underline mt-4"
      >
        → Ir al panel del negocio
      </a>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-rose-600">*</span>}
      </span>
      {children}
    </label>
  );
}
