/**
 * Catálogo de portales de locales comerciales que rastrea el buscador.
 * Incluye marketplaces generalistas y activos de banca.
 *
 * Cada portal tiene un `domain` que se usa para acotar las búsquedas web
 * de Claude (web_search) a esos dominios concretos.
 */

export type Portal = {
  key: string;
  label: string;
  /** Fuente o entidad que opera el portal. Se conserva como `bank` por compatibilidad. */
  bank: string;
  url: string;
  /** Dominio (sin protocolo) para acotar la búsqueda web */
  domain: string;
  kind: "generalist" | "bank_asset";
  operations: Array<"rent" | "sale">;
  /** Algunos marketplaces bloquean la descarga automatizada de la ficha. */
  fetchMode: "verify" | "search_only";
  /** Nota / especialidad del portal */
  note?: string;
};

export const PORTALS: Portal[] = [
  {
    key: "idealista",
    label: "Idealista",
    bank: "Portal generalista",
    url: "https://www.idealista.com/",
    domain: "idealista.com",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only",
    note: "Locales en alquiler y venta."
  },
  {
    key: "fotocasa",
    label: "Fotocasa",
    bank: "Portal generalista",
    url: "https://www.fotocasa.es/",
    domain: "fotocasa.es",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only"
  },
  {
    key: "pisos",
    label: "Pisos.com",
    bank: "Portal generalista",
    url: "https://www.pisos.com/",
    domain: "pisos.com",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only"
  },
  {
    key: "yaencontre",
    label: "Yaencontre",
    bank: "Portal generalista",
    url: "https://www.yaencontre.com/",
    domain: "yaencontre.com",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only"
  },
  {
    key: "habitaclia",
    label: "Habitaclia",
    bank: "Portal generalista",
    url: "https://www.habitaclia.com/",
    domain: "habitaclia.com",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only"
  },
  {
    key: "milanuncios",
    label: "Milanuncios",
    bank: "Portal de anuncios",
    url: "https://www.milanuncios.com/",
    domain: "milanuncios.com",
    kind: "generalist",
    operations: ["rent", "sale"],
    fetchMode: "search_only"
  },
  {
    key: "aliseda",
    label: "Aliseda Inmobiliaria",
    bank: "Banco Santander",
    url: "https://www.alisedainmobiliaria.com/",
    domain: "alisedainmobiliaria.com",
    kind: "bank_asset",
    operations: ["sale"],
    fetchMode: "verify"
  },
  {
    key: "solvia",
    label: "Solvia",
    bank: "Banco Sabadell / CaixaBank",
    url: "https://www.solvia.es/",
    domain: "solvia.es",
    kind: "bank_asset",
    operations: ["rent", "sale"],
    fetchMode: "verify"
  },
  {
    key: "gia",
    label: "Gia Inmobiliaria",
    bank: "Unicaja",
    url: "https://www.gia.es/",
    domain: "gia.es",
    kind: "bank_asset",
    operations: ["rent", "sale"],
    fetchMode: "verify",
    note: "Activos inmobiliarios de Unicaja."
  },
  {
    key: "trial3",
    label: "Trial 3",
    bank: "Varios bancos",
    url: "https://www.trial3.es/",
    domain: "trial3.es",
    kind: "bank_asset",
    operations: ["sale"],
    fetchMode: "verify",
    note: "Especializado en viviendas ocupadas (precio reducido, mayor riesgo)."
  },
  {
    key: "ikesa",
    label: "Ikesa Inmobiliaria",
    bank: "Varios bancos",
    url: "https://www.ikesainmobiliaria.es/",
    domain: "ikesainmobiliaria.es",
    kind: "bank_asset",
    operations: ["sale"],
    fetchMode: "verify",
    note: "Activos inmobiliarios de bancos."
  },
  {
    key: "servihabitat",
    label: "Servihabitat",
    bank: "Activos bancarios",
    url: "https://www.servihabitat.com/",
    domain: "servihabitat.com",
    kind: "bank_asset",
    operations: ["rent", "sale"],
    fetchMode: "verify",
    note: "Locales y activos comerciales."
  }
];

export const PORTAL_KEYS = PORTALS.map((p) => p.key);

export function portalsByKeys(keys: string[]): Portal[] {
  if (!keys || keys.length === 0) return PORTALS;
  const set = new Set(keys);
  const sel = PORTALS.filter((p) => set.has(p.key));
  return sel.length > 0 ? sel : PORTALS;
}
