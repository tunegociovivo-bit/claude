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
      const r = await fetch("/api/bipi/business/signup", {
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
        <h1 className="text-3xl font-bold mb-3">¡Bienvenido a Bipi!</h1>
        <p className="text-slate-700 mb-6">
          Tu negocio está dado de alta. Imprime este QR y ponlo en tu caja para
          que los clientes lo escaneen. Cada escaneo te hace más visible en la red.
        </p>
        <div className="rounded-2xl bg-white border p-6 shadow-sm text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.qrPngUrl}
            alt="QR del negocio"
            className="mx-auto rounded-lg border max-w-xs"
          />
          <p className="mt-4 text-xs font-mono break-all text-slate-500">{result.scanUrl}</p>
          <a
            href={result.qrPngUrl}
            download="bipi-qr.png"
            className="mt-4 inline-block px-4 py-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
          >
            Descargar PNG del QR
          </a>
        </div>
        <p className="text-xs text-slate-500 mt-6">
          Próximamente: cartel auto-generado con IA + login del panel del negocio.
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Alta de negocio en Bipi</h1>
      <p className="text-slate-700 mb-6">
        Gratis. 2 minutos. Saldrás con tu QR listo para imprimir.
      </p>
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
        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium disabled:opacity-50"
        >
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
