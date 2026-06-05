/**
 * Sinónimos de nicho para ampliar la cobertura de una búsqueda. Al buscar
 * "dentista" también se consulta "clínica dental" y "odontólogo", que en
 * Google Places devuelven fichas distintas. Multiplica los resultados sin que
 * el usuario tenga que lanzar varias búsquedas.
 *
 * Es opt-in (casilla en "Nueva búsqueda") porque cada variante es una consulta
 * extra a Google Places (coste).
 */

// Clave en minúsculas → variantes equivalentes (incluida o no la propia clave).
const SYNONYMS: Record<string, string[]> = {
  // Salud / estética
  "dentista": ["clínica dental", "odontólogo"],
  "clínica dental": ["dentista", "odontólogo"],
  "fisioterapeuta": ["clínica de fisioterapia", "fisioterapia"],
  "clínica de fisioterapia": ["fisioterapeuta", "fisioterapia"],
  "podólogo": ["clínica de podología", "centro de podología"],
  "veterinario": ["clínica veterinaria", "centro veterinario"],
  "clínica veterinaria": ["veterinario", "centro veterinario"],
  "óptica": ["centro óptico", "optometrista"],
  "psicólogo": ["gabinete de psicología", "centro de psicología"],
  "nutricionista": ["dietista", "centro de nutrición"],
  "clínica estética": ["medicina estética", "centro de estética"],
  "depilación láser": ["centro de depilación", "depilación láser médica"],
  // Belleza
  "peluquería": ["salón de belleza", "estilista"],
  "barbería": ["barber shop", "peluquería de caballeros"],
  "centro de estética": ["salón de belleza", "estética"],
  "uñas": ["salón de uñas", "manicura"],
  "manicura": ["salón de uñas", "centro de manicura y pedicura"],
  // Hogar / oficios
  "cerrajero": ["cerrajería", "cerrajero urgente 24h"],
  "fontanero": ["fontanería", "fontanero urgente"],
  "electricista": ["instalaciones eléctricas", "electricista urgente"],
  "reformas": ["empresa de reformas", "reformas integrales"],
  "pintor": ["empresa de pintura", "pintor profesional"],
  "carpintero": ["carpintería", "carpintería de madera"],
  "mudanzas": ["empresa de mudanzas", "transportes y mudanzas"],
  "limpieza": ["empresa de limpieza", "servicio de limpieza"],
  "aire acondicionado": ["instalador de aire acondicionado", "climatización"],
  "placas solares": ["instalador de placas solares", "energía solar fotovoltaica"],
  "jardinería": ["empresa de jardinería", "mantenimiento de jardines"],
  "control de plagas": ["empresa de control de plagas", "desratización y desinsectación"],
  // Automoción
  "taller mecánico": ["taller de coches", "mecánico"],
  "chapa y pintura": ["taller de chapa y pintura", "carrocería"],
  "neumáticos": ["taller de neumáticos", "venta de neumáticos"],
  "autoescuela": ["escuela de conducir", "autoescuela"],
  // Hostelería
  "restaurante": ["bar restaurante", "comida para llevar"],
  "cafetería": ["bar cafetería", "café"],
  "pizzería": ["pizza a domicilio", "restaurante italiano"],
  "panadería": ["panadería y pastelería", "obrador"],
  "catering": ["servicio de catering", "empresa de catering"],
  // Comercio
  "tienda de ropa": ["boutique", "moda"],
  "zapatería": ["tienda de zapatos", "calzado"],
  "joyería": ["joyería y relojería", "bisutería"],
  "floristería": ["floristería", "flores a domicilio"],
  "ferretería": ["ferretería", "suministros industriales"],
  "reparación de móviles": ["tienda de telefonía", "servicio técnico de móviles"],
  // Servicios profesionales
  "asesoría": ["gestoría", "asesoría fiscal y laboral"],
  "gestoría": ["asesoría", "asesoría fiscal y laboral"],
  "abogado": ["despacho de abogados", "bufete de abogados"],
  "inmobiliaria": ["agencia inmobiliaria", "agente inmobiliario"],
  "arquitecto": ["estudio de arquitectura", "arquitecto técnico"],
  "seguros": ["agencia de seguros", "correduría de seguros"],
  "agencia de marketing": ["agencia de publicidad", "agencia digital"],
  "imprenta": ["artes gráficas", "imprenta digital"],
  // Formación / ocio
  "academia de idiomas": ["escuela de idiomas", "academia de inglés"],
  "gimnasio": ["centro deportivo", "sala fitness"],
  "yoga": ["centro de yoga", "estudio de pilates"],
  "guardería": ["escuela infantil", "centro de educación infantil"],
  // Eventos / otros
  "fotógrafo": ["estudio de fotografía", "fotografía profesional"],
  "funeraria": ["servicios funerarios", "tanatorio"],
  "agencia de viajes": ["agencia de viajes", "turismo"],
  "lavandería": ["tintorería", "lavandería autoservicio"]
};

/** Normaliza para buscar en el mapa (minúsculas, sin tildes ni plurales tontos). */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Variantes equivalentes de un nicho (sin incluir el original). */
export function keywordSynonyms(keyword: string): string[] {
  const k = norm(keyword);
  if (SYNONYMS[k]) return SYNONYMS[k];
  // Coincidencia laxa: si el keyword contiene una clave conocida (o al revés).
  for (const key of Object.keys(SYNONYMS)) {
    if (k.includes(key) || key.includes(k)) return SYNONYMS[key];
  }
  return [];
}

/**
 * Devuelve el keyword original + sus sinónimos, deduplicado y limitado a `max`
 * variantes (incluido el original) para no disparar el coste de la API.
 */
export function expandKeyword(keyword: string, max = 3): string[] {
  const base = keyword.trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [base, ...keywordSynonyms(base)]) {
    const key = norm(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out.length ? out : [base];
}
