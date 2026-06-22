/**
 * Mapeo aproximado de la categoría libre de un comercio de Bubui a un código
 * CNAE (Clasificación Nacional de Actividades Económicas). No pretende ser
 * exacto: sirve para que el cruce IA de subvenciones tenga una señal de
 * actividad estandarizada además del texto libre, mejorando el encaje.
 */

type CnaeHit = { code: string; label: string };

// Reglas por palabra clave (orden = prioridad). La categoría se normaliza
// (minúsculas, sin acentos) antes de buscar.
const RULES: { kw: RegExp; code: string; label: string }[] = [
  { kw: /restaur|comida|cocina|tapas|marisquer|pizzer|hamburgues/, code: "5610", label: "Restaurantes y puestos de comidas" },
  { kw: /bar|cafe|cafeter|pub|cervec|coctel/, code: "5630", label: "Establecimientos de bebidas" },
  { kw: /peluquer|barber/, code: "9602", label: "Peluquería y tratamientos de belleza" },
  { kw: /estetic|spa|belleza|uñas|manicur|depilac/, code: "9602", label: "Peluquería y tratamientos de belleza" },
  { kw: /gimnas|fitness|crossfit|yoga|pilates|deport/, code: "9313", label: "Actividades de gimnasios" },
  { kw: /nutric|dietet|fisio|salud|clinic|dental|psicolog/, code: "8690", label: "Otras actividades sanitarias" },
  { kw: /moda|ropa|boutique|textil|calzado|zapat/, code: "4771", label: "Comercio al por menor de prendas de vestir" },
  { kw: /joyer|relojer|bisuter/, code: "4777", label: "Comercio al por menor de artículos de relojería y joyería" },
  { kw: /florist|flores|plantas/, code: "4776", label: "Comercio al por menor de flores y plantas" },
  { kw: /regalo|souvenir|deco|hogar|bazar/, code: "4778", label: "Otro comercio al por menor de artículos nuevos" },
  { kw: /panader|pasteler|confiter|horno/, code: "4724", label: "Comercio al por menor de pan y pastelería" },
  { kw: /farmac|parafarmac/, code: "4773", label: "Comercio al por menor de productos farmacéuticos" },
  { kw: /ferreter|bricolaj/, code: "4752", label: "Comercio al por menor de ferretería" },
  { kw: /hotel|hostal|aparta|aloja|turismo/, code: "5510", label: "Hoteles y alojamientos similares" }
];

const RETAIL_FALLBACK: CnaeHit = { code: "4719", label: "Comercio al por menor en establecimientos no especializados" };
const SERVICES_FALLBACK: CnaeHit = { code: "9609", label: "Otros servicios personales" };

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Devuelve el CNAE aproximado para una categoría. `businessType` ("restaurante"
 * | "comercio_producto" | "servicios") afina el fallback cuando la categoría no
 * casa con ninguna regla.
 */
export function cnaeForCategory(category?: string | null, businessType?: string | null): CnaeHit | null {
  const c = norm(category ?? "");
  if (c) {
    for (const r of RULES) if (r.kw.test(c)) return { code: r.code, label: r.label };
  }
  if (businessType === "restaurante") return { code: "5610", label: "Restaurantes y puestos de comidas" };
  if (businessType === "comercio_producto") return RETAIL_FALLBACK;
  if (businessType === "servicios") return SERVICES_FALLBACK;
  return null;
}
