// Sección informativa permanente: cómo se activan llamadas y WhatsApp, quién
// hace cada paso y qué costes reales tiene. Sin códigos de desvío universales
// (dependen del operador) y sin jerga técnica.

function Item({ who, children }: { who: "Tú" | "Negocio Vivo" | "Juntos"; children: React.ReactNode }) {
  const color = who === "Tú" ? "bg-sky-100 text-sky-800" : who === "Negocio Vivo" ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800";
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{who}</span>
      <span className="text-slate-600">{children}</span>
    </li>
  );
}

export default function PhoneActivationGuide() {
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-sm">
      <p className="mb-1 font-medium">Cómo activar llamadas y WhatsApp</p>
      <p className="mb-3 text-xs text-slate-500">
        Tu número de siempre se queda en tu SIM y en tu operador. Para que PAULA atienda las llamadas, Negocio Vivo crea una
        línea nueva dedicada y tu móvil desvía las llamadas hacia ella. WhatsApp no se mueve: sigue en tu móvil.
      </p>
      <ol className="space-y-2">
        <Item who="Tú">Indica arriba el número de tu negocio y guárdalo. No hace falta contratar nada ni dar contraseñas.</Item>
        <Item who="Tú">Vincula tu WhatsApp escaneando el código QR en la sección «WhatsApp» de esta página. Tu WhatsApp sigue funcionando en tu móvil como siempre.</Item>
        <Item who="Negocio Vivo">Creamos la línea de llamadas dedicada a tu negocio (incluye una verificación regulatoria que puede tardar unos días) y la conectamos con PAULA y con tu CRM.</Item>
        <Item who="Negocio Vivo">Te avisamos cuando esté lista y te indicamos cómo activar el desvío de llamadas desde tu móvil. El procedimiento exacto depende de tu operador (SIMYO, Movistar, Vodafone…); te lo damos paso a paso.</Item>
        <Item who="Juntos">Pruebas finales: llamamos a tu número y comprueba que PAULA contesta; si tu plan incluye llamadas salientes, hacemos una de prueba; y enviamos un WhatsApp para verificar que PAULA responde.</Item>
      </ol>
      <p className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-500">
        <b>Costes, sin letra pequeña:</b> la línea dedicada tiene un pequeño coste mensual y las llamadas desviadas pueden
        consumir minutos o tener coste según tu tarifa móvil (el desvío lo cobra tu operador, no Negocio Vivo). Antes de
        activar nada te confirmamos los importes. Puedes desactivar el desvío desde tu móvil en cualquier momento y tu
        número vuelve a sonar solo en tu teléfono.
      </p>
    </div>
  );
}
