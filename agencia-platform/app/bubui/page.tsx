/**
 * Landing pública de Bubui — v2 diseño limpio premium.
 * Wordmark con punto rosa, slogan "Ahorra. Disfruta. Apoya local."
 */

import Link from "next/link";

// En producción la landing vive en bubui.app; como fallback usamos el Hub.
const SITE_URL = process.env.NEXT_PUBLIC_BUBUI_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://hub.negociovivo.app";

const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Bubui",
  alternateName: "Bubui · Red de negocios locales",
  url: `${SITE_URL}/bubui`,
  logo: `${SITE_URL}/bubui/icon-512.png`,
  description: "Red de negocios locales que se recomiendan entre sí. Cada compra te abre descuentos cerca. Piloto en Benalmádena.",
  areaServed: {
    "@type": "City",
    name: "Benalmádena",
    "@id": "https://www.wikidata.org/wiki/Q15683"
  },
  slogan: "Ahorra. Disfruta. Apoya local.",
  parentOrganization: {
    "@type": "Organization",
    name: "Negocio Vivo"
  }
};

export default function BubuiHome() {
  return (
    <main className="max-w-5xl mx-auto px-4 pt-12 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
      />
      {/* HERO */}
      <section className="text-center">
        <span className="bubui-eyebrow bubui-fade-up">Nuevo · Piloto en Benalmádena</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bubui/logo.png"
          alt="bubui"
          className="mx-auto mt-6 bubui-fade-up bubui-fade-up-1"
          style={{ height: "clamp(72px, 18vw, 150px)", width: "auto" }}
        />
        <p className="bubui-fade-up bubui-fade-up-2 mt-2 text-xl sm:text-2xl font-bold tracking-tight text-black">
          Ahorra. Disfruta. <span style={{ color: "#EC4899" }}>Apoya local.</span>
        </p>
        <p className="mt-5 text-base text-black/60 max-w-xl mx-auto bubui-fade-up bubui-fade-up-3">
          Una red de negocios del barrio que se recomiendan entre sí.
          Pagas, escaneas, y se te abren descuentos cerca.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 bubui-fade-up bubui-fade-up-4">
          <Link href="/bubui/registro" className="bubui-btn">
            Quiero registrar mi negocio
          </Link>
          <Link href="/bubui/app" className="bubui-btn-ghost">
            Soy cliente · Abrir app
          </Link>
        </div>
        <p className="mt-4 text-sm text-black/55 bubui-fade-up bubui-fade-up-4">
          ¿Ya tienes un negocio en Bubui?{" "}
          <Link href="/negocios" className="text-pink-600 font-semibold underline">
            Acceder a mi panel
          </Link>
        </p>
      </section>

      {/* Cómo funciona */}
      <section className="mt-24">
        <h2 className="text-3xl sm:text-4xl font-black text-center mb-10 tracking-tight">
          Así funciona
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          <Step n={1} title="Pagas en una tienda Bubui">
            Escaneas el QR de la caja con la app. Te aplican 5%, 8% o más, según el negocio.
          </Step>
          <Step n={2} title="Desbloqueas descuentos cerca">
            Tu compra te abre <strong>3-5 cupones</strong> en negocios cerca de ti. Caducan en 4 días.
          </Step>
          <Step n={3} title="Saltas de uno a otro">
            Vas a otro negocio Bubui → escaneas → más descuentos. Cuanto más usas, más ahorras.
          </Step>
        </div>
      </section>

      {/* CTA negocios */}
      <section className="mt-24 bubui-card p-10 text-center relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="bubui-eyebrow">Para negocios</span>
          <h2 className="text-3xl sm:text-4xl font-black mt-4 tracking-tight">
            ¿Tienes un negocio en Benalmádena?
          </h2>
          <p className="text-black/60 max-w-xl mx-auto mt-3">
            Únete gratis y empieza a recibir clientes del barrio. La red crece sola: cuanto más
            activo eres, más visible te haces para los demás.
          </p>
          <Link href="/bubui/registro" className="bubui-btn mt-6 inline-flex">
            Crear cuenta de negocio →
          </Link>
          <p className="mt-4 text-sm text-black/55">
            ¿Ya estás dado de alta?{" "}
            <Link href="/negocios" className="text-pink-600 font-semibold underline">
              Inicia sesión en tu panel
            </Link>
          </p>
        </div>
      </section>

      {/* Beneficios visuales */}
      <section className="mt-20 grid md:grid-cols-3 gap-3">
        <Stat big="0 €" label="Coste para empezar" />
        <Stat big="4 días" label="Caducidad de cupones" />
        <Stat big="∞" label="Negocios que puedes traer" />
      </section>

      {/* Footer con soporte y legal (visible para usuarios y para App Store) */}
      <footer className="mt-20 border-t pt-8 pb-4 text-sm text-black/60">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/directorio" className="text-pink-600 font-semibold">Directorio de negocios</Link>
          <Link href="/bubui/soporte" className="text-pink-600 font-semibold">Soporte y ayuda</Link>
          <Link href="/bubui/privacidad" className="text-pink-600 font-semibold">Privacidad</Link>
          <a href="mailto:hola@bubui.app" className="text-pink-600 font-semibold">hola@bubui.app</a>
        </div>
        <p className="mt-3 text-black/40">© {new Date().getFullYear()} Bubui · NegocioVivo, Benalmádena (Málaga)</p>
      </footer>
    </main>
  );
}

function Step({
  n,
  title,
  children
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bubui-card p-6">
      <div
        className="text-7xl font-black leading-none"
        style={{
          background: "linear-gradient(135deg, #EC4899, #DB2777)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent"
        }}
      >
        {n}
      </div>
      <h3 className="font-bold text-lg mt-3 mb-2">{title}</h3>
      <p className="text-black/60 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="bubui-card p-6 text-center">
      <div className="bubui-discount-big">{big}</div>
      <div className="text-[11px] uppercase tracking-wider text-black/50 mt-2 font-bold">
        {label}
      </div>
    </div>
  );
}
