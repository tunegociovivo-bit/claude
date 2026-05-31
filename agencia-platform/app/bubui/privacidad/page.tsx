/**
 * Política de privacidad de Bubui — requerida por Google Play y App Store.
 * URL pública: https://bubui.app/privacidad
 */

import Link from "next/link";

export const metadata = {
  title: "Política de privacidad — Bubui",
  description: "Cómo Bubui recopila, usa y protege tus datos personales."
};

const UPDATED = "31 de mayo de 2026";

export default function PrivacidadPage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 text-black/80 leading-relaxed">
      <Link href="/bubui" className="text-pink-600 font-semibold text-sm">← Volver a Bubui</Link>
      <h1 className="text-3xl font-extrabold text-black mt-4 mb-1">Política de privacidad</h1>
      <p className="text-sm text-black/50 mb-8">Última actualización: {UPDATED}</p>

      <p className="mb-6">
        En Bubui (operado por NegocioVivo) nos tomamos en serio tu privacidad. Esta
        política explica qué datos recogemos, para qué los usamos y qué control tienes
        sobre ellos cuando usas la app y la web de Bubui.
      </p>

      <Section title="1. Quién es el responsable">
        Responsable del tratamiento: NegocioVivo, Benalmádena (Málaga), España.
        Contacto: <a className="text-pink-600" href="mailto:hola@bubui.app">hola@bubui.app</a>.
      </Section>

      <Section title="2. Qué datos recogemos">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Datos de cuenta:</b> nombre, correo electrónico, teléfono y fecha de nacimiento cuando te registras. La fecha de nacimiento se usa para verificar que eres mayor de edad mínima y para ofertas personalizadas (p. ej. cupón de cumpleaños).</li>
          <li><b>Ubicación:</b> tu ubicación aproximada o precisa para mostrarte descuentos cerca de ti y validar que la compra se hace en el local (anti-fraude). Solo se usa mientras la app está en uso.</li>
          <li><b>Cámara:</b> para escanear los códigos QR de los negocios. Las imágenes no se almacenan.</li>
          <li><b>Uso del servicio:</b> compras registradas, ofertas canjeadas y métricas de ahorro.</li>
          <li><b>Notificaciones push:</b> un identificador del dispositivo para enviarte avisos de ofertas (puedes desactivarlas).</li>
        </ul>
      </Section>

      <Section title="3. Para qué usamos tus datos">
        <ul className="list-disc pl-5 space-y-1">
          <li>Aplicarte descuentos y desbloquear ofertas en negocios cercanos tras cada compra.</li>
          <li>Mostrarte negocios y ofertas relevantes según tu ubicación.</li>
          <li>Prevenir fraude (comprobar que el escaneo ocurre en el local).</li>
          <li>Enviarte notificaciones sobre ofertas que caducan o nuevas oportunidades cerca.</li>
          <li>Gestionar el programa de afiliados (invitaciones entre clientes).</li>
        </ul>
      </Section>

      <Section title="4. Base legal">
        Tratamos tus datos para ejecutar el servicio que solicitas (contrato) y, en el
        caso de las notificaciones y la ubicación, con tu consentimiento, que puedes
        retirar en cualquier momento desde los ajustes de tu dispositivo.
      </Section>

      <Section title="5. Con quién los compartimos">
        No vendemos tus datos. Solo los compartimos con proveedores que nos ayudan a
        operar el servicio: pagos (Stripe), envío de SMS de verificación (Twilio),
        notificaciones push y alojamiento. Cada uno trata los datos siguiendo sus
        propias obligaciones de protección de datos.
      </Section>

      <Section title="6. Cuánto tiempo los conservamos">
        Conservamos tus datos mientras tu cuenta esté activa. Si solicitas la
        eliminación, borramos tus datos personales salvo los que la ley nos obligue a
        conservar (p. ej. registros de facturación).
      </Section>

      <Section title="7. Tus derechos">
        Puedes acceder, rectificar o eliminar tus datos, así como oponerte o limitar su
        tratamiento, escribiéndonos a <a className="text-pink-600" href="mailto:hola@bubui.app">hola@bubui.app</a>.
        También puedes reclamar ante la Agencia Española de Protección de Datos (AEPD).
      </Section>

      <Section title="8. Eliminación de cuenta y datos">
        Para eliminar tu cuenta y todos tus datos personales, envía un correo a{" "}
        <a className="text-pink-600" href="mailto:hola@bubui.app">hola@bubui.app</a> desde
        la dirección asociada a tu cuenta. Procesamos las solicitudes en un plazo
        máximo de 30 días.
      </Section>

      <Section title="9. Menores">
        Bubui no está dirigido a menores de 16 años y no recogemos datos de menores de
        forma intencionada. Si detectamos una cuenta de un menor de 16 años, la
        eliminaremos.
      </Section>

      <Section title="10. Cambios">
        Podemos actualizar esta política. Publicaremos la versión vigente en esta misma
        página con su fecha de actualización.
      </Section>

      <p className="text-sm text-black/50 mt-10">
        ¿Dudas sobre privacidad? Escríbenos a{" "}
        <a className="text-pink-600" href="mailto:hola@bubui.app">hola@bubui.app</a>.
      </p>
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
