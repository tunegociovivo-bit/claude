"use client";

/**
 * Página que abre el QR del negocio en el móvil del cliente.
 *
 * Flujo:
 *   1. Si el cliente NO tiene customerId en localStorage → primero le pedimos
 *      email/nombre (alta express). El primer escaneo lo registra y lo asocia
 *      a este negocio como "negocio de origen".
 *   2. Tras alta o si ya tiene sesión: pide importe pagado.
 *   3. Pulsa "Confirmar" → POST /api/bipi/scan → muestra pantalla "esperando
 *      validación del negocio".
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Customer = { customerId: string; name?: string; totalSaved: number; totalPurchases: number };

export default function ScanPage() {
  const params = useParams() as { businessId: string };
  const businessId = params.businessId;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [stage, setStage] = useState<"signup" | "amount" | "sent">("signup");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bipi.customer");
      if (raw) {
        setCustomer(JSON.parse(raw));
        setStage("amount");
      }
    } catch {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => {},
        { timeout: 5000, enableHighAccuracy: true }
      );
    }
  }, []);

  async function signup(email: string, name: string) {
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/customer/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, firstBusinessId: businessId })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      const c = { customerId: j.customerId, name: j.name, totalSaved: j.totalSaved ?? 0, totalPurchases: j.totalPurchases ?? 0 };
      localStorage.setItem("bipi.customer", JSON.stringify(c));
      setCustomer(c);
      setStage("amount");
    } finally {
      setSending(false);
    }
  }

  async function submitAmount() {
    if (!customer) return;
    const value = Number(amount.replace(",", "."));
    if (!value || value <= 0) {
      setError("Importe inválido");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/bipi/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          customerId: customer.customerId,
          amount: value,
          scanLat: coords?.lat,
          scanLng: coords?.lng
        })
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      setResult(j);
      setStage("sent");
    } finally {
      setSending(false);
    }
  }

  if (stage === "signup") {
    return <SignupForm onSubmit={signup} busy={sending} error={error} />;
  }

  if (stage === "amount") {
    return (
      <main className="max-w-md mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-2">¿Cuánto has pagado?</h1>
        <p className="text-slate-600 text-sm mb-6">Introduce el importe del ticket. El negocio confirmará y te aplicarán el descuento.</p>
        <div className="bg-white border rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-baseline gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              className="flex-1 text-5xl font-black border-b-2 border-pink-500 focus:outline-none focus:border-pink-600 py-2 bg-transparent"
            />
            <span className="text-3xl font-bold text-black/50">€</span>
          </div>
          {error && <p className="text-rose-700 text-sm">{error}</p>}
          <button
            onClick={submitAmount}
            disabled={sending || !amount}
            className="bipi-btn w-full"
          >
            {sending ? "Enviando…" : "Confirmar"}
          </button>
        </div>
      </main>
    );
  }

  // sent
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white border rounded-xl p-6 shadow-sm text-center space-y-4">
        {result?.status === "rejected" ? (
          <>
            <div className="text-5xl">❌</div>
            <h2 className="text-xl font-bold">Escaneo no válido</h2>
            <p className="text-sm text-slate-600">{result.rejectionReason}</p>
          </>
        ) : (
          <>
            <div className="text-5xl">✅</div>
            <h2 className="text-xl font-bold">Enviado al negocio</h2>
            <p className="text-sm text-slate-600">
              Esperando que el negocio confirme el importe. En cuanto confirme, se te aplica
              el <strong>{result?.discountPct ?? "—"}%</strong> de descuento.
            </p>
            {result?.offerRedeemed && (
              <p className="text-sm font-semibold text-pink-600">🎟 Estás canjeando un cupón cruzado.</p>
            )}
            <p className="text-xs text-black/50">
              Cuando el negocio confirme, desbloquearás 3-5 cupones nuevos en otros negocios cerca.
            </p>
            <a href="/bipi/app" className="bipi-btn block text-center">
              Ver mis cupones
            </a>
          </>
        )}
      </div>
    </main>
  );
}

function SignupForm({
  onSubmit,
  busy,
  error
}: {
  onSubmit: (email: string, name: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-6">
        <h1 className="text-5xl font-black"><span className="bipi-brand">bipi</span></h1>
        <p className="text-slate-600 text-sm mt-2">
          ¡Estás a un paso de tu descuento! Crea tu cuenta — 30 segundos.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(email, name);
        }}
        className="space-y-3 bg-white border rounded-xl p-5 shadow-sm"
      >
        <input
          type="text"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 border rounded-lg bg-white"
        />
        {error && <p className="text-rose-700 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="bipi-btn w-full"
        >
          {busy ? "Creando…" : "Crear cuenta y seguir"}
        </button>
      </form>
    </main>
  );
}
