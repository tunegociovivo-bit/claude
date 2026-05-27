/**
 * Landing pública de Bipi — paleta rosa + negro + blanco, animaciones
 * de entrada y CTA muy llamativos.
 */

import Link from "next/link";

export default function BipiHome() {
  return (
    <main className="max-w-5xl mx-auto px-4 pt-12 pb-24">
      {/* HERO */}
      <section className="text-center">
        <span className="bipi-eyebrow bipi-fade-up">🚀 Nuevo · Piloto en Benalmádena</span>
        <h1 className="bipi-hero-title mt-5 bipi-fade-up bipi-fade-up-1">
          Cada compra te <br />
          <span className="bipi-brand">abre descuentos</span> <br />
          cerca de ti.
        </h1>
        <p className="mt-6 text-lg text-black/70 max-w-2xl mx-auto bipi-fade-up bipi-fade-up-2">
          Bipi es una red de negocios locales que se recomiendan entre sí.
          Sin tarjetas. Sin puntos. Sin spam.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 bipi-fade-up bipi-fade-up-3">
          <Link href="/bipi/registro" className="bipi-btn inline-flex items-center gap-2">
            🏪 Quiero registrar mi negocio
          </Link>
          <Link href="/bipi/app" className="bipi-btn-ghost inline-flex items-center gap-2">
            🛍 Soy cliente
          </Link>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="mt-24">
        <h2 className="text-4xl font-black text-center mb-10 tracking-tight">
          Así funciona
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Step n={1} title="Pagas en una tienda Bipi" color="from-pink-500 to-pink-600">
            Escaneas el QR de la caja con la app. Te aplican 5%, 8% o más, según el negocio.
          </Step>
          <Step n={2} title="Desbloqueas descuentos cerca" color="from-pink-600 to-pink-500">
            Tu compra te abre <strong>3-5 cupones</strong> en negocios cerca de ti. Caducan en 4 días.
          </Step>
          <Step n={3} title="Saltas de uno a otro" color="from-pink-500 to-pink-600">
            Vas a otro negocio Bipi → escaneas → más descuentos. Cuanto más usas, más ahorras.
          </Step>
        </div>
      </section>

      {/* CTA negocios */}
      <section className="mt-24 bipi-card p-10 text-center relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="bipi-eyebrow">🏪 Para negocios</span>
          <h2 className="text-4xl font-black mt-4 tracking-tight">
            ¿Tienes un negocio en Benalmádena?
          </h2>
          <p className="text-black/70 max-w-2xl mx-auto mt-3">
            Únete gratis y empieza a recibir clientes del barrio. La red crece sola: cuanto más
            activo eres, más visible te haces para los demás.
          </p>
          <Link href="/bipi/registro" className="bipi-btn mt-6 inline-block">
            Crear cuenta de negocio →
          </Link>
        </div>
      </section>

      {/* Beneficios visuales */}
      <section className="mt-20 grid md:grid-cols-3 gap-3">
        <Stat big="0 €" label="Coste para empezar" />
        <Stat big="4 días" label="Caducidad de cupones" />
        <Stat big="∞" label="Negocios que puedes traer" />
      </section>
    </main>
  );
}

function Step({
  n,
  title,
  color,
  children
}: {
  n: number;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bipi-card p-6 relative">
      <div className={`text-7xl font-black bg-gradient-to-br ${color} bg-clip-text text-transparent leading-none`}>
        {n}
      </div>
      <h3 className="font-bold text-lg mt-3 mb-2">{title}</h3>
      <p className="text-black/70 text-sm">{children}</p>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="bipi-card p-6 text-center">
      <div className="bipi-discount-big">{big}</div>
      <div className="text-xs uppercase tracking-wider text-black/50 mt-2 font-semibold">
        {label}
      </div>
    </div>
  );
}
