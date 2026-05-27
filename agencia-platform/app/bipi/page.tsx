/**
 * Landing pública de Bipi.
 *
 * Dos CTAs claros:
 *   - "Quiero darme de alta como negocio" → /bipi/registro
 *   - "Soy cliente: descárgame la app" → /bipi/app
 */

import Link from "next/link";

export default function BipiHome() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      <section className="text-center space-y-4">
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">
          <span className="text-amber-600">bi</span>pi
        </h1>
        <p className="text-lg text-slate-700 max-w-xl mx-auto">
          Cada compra en un negocio Bipi te abre descuentos en otros negocios
          de tu barrio. Sin tarjetas. Sin puntos. Sin esperar.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link
            href="/bipi/registro"
            className="px-6 py-3 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium shadow"
          >
            🏪 Soy un negocio
          </Link>
          <Link
            href="/bipi/app"
            className="px-6 py-3 rounded-full bg-white border border-amber-300 text-amber-800 font-medium shadow-sm hover:bg-amber-50"
          >
            🛍 Soy cliente
          </Link>
        </div>
      </section>

      <section className="mt-16 grid md:grid-cols-3 gap-6">
        <Card title="1. Pagas en una tienda Bipi">
          Escaneas el QR de la caja con la app. Te aplican 5%, 8%, 12%… según el negocio.
        </Card>
        <Card title="2. Descubres descuentos cerca">
          Tu compra te abre 4 cupones en negocios cerca de ti. Caducan en 4 días.
        </Card>
        <Card title="3. Saltas de uno a otro">
          Vas a otro negocio Bipi → escaneas → más descuentos. Cuanto más usas, más ahorras.
        </Card>
      </section>

      <section className="mt-16 rounded-2xl bg-white border p-8 shadow-sm">
        <h2 className="text-2xl font-bold mb-3">¿Tienes un negocio en Benalmádena?</h2>
        <p className="text-slate-700 mb-4">
          Estamos arrancando el piloto. Únete gratis y empieza a recibir clientes
          del barrio que vienen con cupón en la mano. La red crece sola: cuanto
          más activo eres, más visible te haces para los demás clientes.
        </p>
        <Link
          href="/bipi/registro"
          className="inline-block px-5 py-2.5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-medium"
        >
          Crear cuenta de negocio →
        </Link>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white border p-6 shadow-sm">
      <h3 className="font-semibold mb-2 text-amber-900">{title}</h3>
      <p className="text-sm text-slate-700">{children}</p>
    </div>
  );
}
