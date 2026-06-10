/**
 * Página de soporte/ayuda de Bubui — requerida por App Store (Guideline 1.5,
 * "Support URL"). URL pública: https://bubui.app/soporte
 *
 * Debe ofrecer una forma clara de contactar y resolver dudas.
 */

import Link from "next/link";

export const metadata = {
  title: "Soporte y ayuda — Bubui",
  description: "¿Necesitas ayuda con Bubui? Preguntas frecuentes y cómo contactarnos."
};

const SUPPORT_EMAIL = "hola@bubui.app";

export default function SoportePage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 text-black/80 leading-relaxed">
      <Link href="/bubui" className="text-pink-600 font-semibold text-sm">← Volver a Bubui</Link>
      <h1 className="text-3xl font-extrabold text-black mt-4 mb-1">Soporte y ayuda</h1>
      <p className="text-sm text-black/50 mb-8">Estamos aquí para ayudarte con cualquier duda o problema.</p>

      {/* Contacto destacado */}
      <div className="rounded-2xl border border-pink-200 bg-pink-50 p-5 mb-8">
        <h2 className="text-lg font-bold text-black mb-1">¿Necesitas ayuda?</h2>
        <p className="mb-3">
          Escríbenos y te respondemos lo antes posible (normalmente en menos de 48 horas
          laborables).
        </p>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=Soporte%20Bubui`}
          className="inline-flex items-center gap-2 rounded-full bg-pink-600 text-white font-semibold px-5 py-2.5"
        >
          Escribir a {SUPPORT_EMAIL}
        </a>
      </div>

      <Section title="¿Necesito registrarme para usar Bubui?">
        No. Puedes <b>explorar la app y ver los descuentos de los negocios cercanos sin
        crear cuenta</b>. Solo necesitas registrarte (gratis, con tu teléfono) cuando quieras
        <b> canjear una oferta, escanear un ticket o guardar tus favoritos</b>.
      </Section>

      <Section title="¿Cómo funciona?">
        <ul className="list-disc pl-5 space-y-1">
          <li>Explora los negocios y ofertas cerca de ti.</li>
          <li>Cuando compras en un negocio adherido, escaneas el QR de caja o el ticket.</li>
          <li>Desbloqueas descuentos, sorteos y productos gratis en negocios locales.</li>
          <li>Cuanto más compras en el barrio, más premios ganas.</li>
        </ul>
      </Section>

      <Section title="No me llega el código por SMS">
        Comprueba que el número es correcto y que tienes cobertura. El SMS puede tardar
        un par de minutos; si no llega, pide un código nuevo. Si el problema persiste,
        escríbenos a <a className="text-pink-600" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </Section>

      <Section title="El escaneo del ticket o del QR no funciona">
        Asegúrate de dar permiso de cámara a la app y de que el ticket se vea completo y
        con buena luz. Si sigue fallando, mándanos una foto del ticket a{" "}
        <a className="text-pink-600" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> y lo revisamos.
      </Section>

      <Section title="Quiero eliminar mi cuenta y mis datos">
        Envía un correo a <a className="text-pink-600" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
        desde la dirección asociada a tu cuenta y la eliminamos junto con tus datos
        personales en un plazo máximo de 30 días. Más detalles en nuestra{" "}
        <Link className="text-pink-600" href="/bubui/privacidad">política de privacidad</Link>.
      </Section>

      <Section title="Soy un negocio y quiero unirme">
        Puedes crear tu cuenta de negocio gratis desde{" "}
        <Link className="text-pink-600" href="/bubui/registro">aquí</Link>, o escríbenos a{" "}
        <a className="text-pink-600" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> y te ayudamos a empezar.
      </Section>

      <div className="mt-10 border-t pt-6 text-sm text-black/60">
        <p className="font-semibold text-black mb-1">Responsable</p>
        <p>NegocioVivo · Benalmádena (Málaga), España</p>
        <p className="mt-2">
          Email de soporte:{" "}
          <a className="text-pink-600" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <p className="mt-3">
          <Link className="text-pink-600" href="/bubui/privacidad">Política de privacidad</Link>
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-bold text-black mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  );
}
