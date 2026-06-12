/**
 * Catálogo de portales inmobiliarios de banca / activos adjudicados que
 * el "Buscador Inmobiliario" rastrea. La IA busca propiedades en estos
 * portales y analiza cuáles son una buena oportunidad de inversión.
 *
 * Cada portal tiene un `domain` que se usa para acotar las búsquedas web
 * de Claude (web_search) a esos dominios concretos.
 */

export type Portal = {
  key: string;
  label: string;
  /** Banco/entidad con la que trabaja el portal */
  bank: string;
  url: string;
  /** Dominio (sin protocolo) para acotar la búsqueda web */
  domain: string;
  /** Nota / especialidad del portal */
  note?: string;
};

export const PORTALS: Portal[] = [
  {
    key: "aliseda",
    label: "Aliseda Inmobiliaria",
    bank: "Banco Santander",
    url: "https://www.alisedainmobiliaria.com/",
    domain: "alisedainmobiliaria.com"
  },
  {
    key: "solvia",
    label: "Solvia",
    bank: "Banco Sabadell / CaixaBank",
    url: "https://www.solvia.es/",
    domain: "solvia.es"
  },
  {
    key: "gia",
    label: "Gia Inmobiliaria",
    bank: "Unicaja",
    url: "https://www.gia.es/",
    domain: "gia.es",
    note: "Activos inmobiliarios de Unicaja."
  },
  {
    key: "trial3",
    label: "Trial 3",
    bank: "Varios bancos",
    url: "https://www.trial3.es/",
    domain: "trial3.es",
    note: "Especializado en viviendas ocupadas (precio reducido, mayor riesgo)."
  },
  {
    key: "ikesa",
    label: "Ikesa Inmobiliaria",
    bank: "Varios bancos",
    url: "https://www.ikesainmobiliaria.es/",
    domain: "ikesainmobiliaria.es",
    note: "Activos inmobiliarios de bancos."
  }
];

export const PORTAL_KEYS = PORTALS.map((p) => p.key);

export function portalsByKeys(keys: string[]): Portal[] {
  if (!keys || keys.length === 0) return PORTALS;
  const set = new Set(keys);
  const sel = PORTALS.filter((p) => set.has(p.key));
  return sel.length > 0 ? sel : PORTALS;
}
