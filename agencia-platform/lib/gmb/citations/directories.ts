/**
 * Catálogo EXTENSIBLE de directorios de citaciones locales (España). Solo metadatos públicos
 * (nombre, país, sectores relevantes, autoridad aproximada, URL de alta). NO publica nada ni
 * inventa altas: el Citation Engine usa este catálogo para construir el inventario y, cuando no
 * hay integración real, generar un "paquete de alta" accionable y trazable.
 *
 * `authority` es una estimación de relevancia/autoridad 0–100 (orientativa para priorizar).
 * `sectors` vacío = generalista (aplica a cualquier sector).
 */
export type Directory = {
  slug: string;
  name: string;
  country: string; // ISO-2
  authority: number; // 0-100
  sectors: string[]; // vacío = generalista
  submitUrl: string; // página pública de alta/edición
  homeUrl: string;
};

export const DIRECTORIES: Directory[] = [
  { slug: "google-business", name: "Google Business Profile", country: "ES", authority: 100, sectors: [], submitUrl: "https://www.google.com/business/", homeUrl: "https://business.google.com" },
  { slug: "bing-places", name: "Bing Places", country: "ES", authority: 80, sectors: [], submitUrl: "https://www.bingplaces.com/", homeUrl: "https://www.bingplaces.com" },
  { slug: "apple-maps", name: "Apple Business Connect", country: "ES", authority: 82, sectors: [], submitUrl: "https://businessconnect.apple.com/", homeUrl: "https://businessconnect.apple.com" },
  { slug: "facebook-page", name: "Facebook (Página de empresa)", country: "ES", authority: 78, sectors: [], submitUrl: "https://www.facebook.com/pages/create", homeUrl: "https://www.facebook.com" },
  { slug: "paginas-amarillas", name: "Páginas Amarillas", country: "ES", authority: 70, sectors: [], submitUrl: "https://www.paginasamarillas.es/darse-de-alta", homeUrl: "https://www.paginasamarillas.es" },
  { slug: "yelp-es", name: "Yelp España", country: "ES", authority: 74, sectors: ["restaurante", "hosteleria", "belleza", "servicios"], submitUrl: "https://biz.yelp.es/", homeUrl: "https://www.yelp.es" },
  { slug: "tripadvisor", name: "Tripadvisor", country: "ES", authority: 76, sectors: ["restaurante", "hosteleria", "hotel", "turismo"], submitUrl: "https://www.tripadvisor.es/Owners", homeUrl: "https://www.tripadvisor.es" },
  { slug: "eldtenedor", name: "ElTenedor (TheFork)", country: "ES", authority: 68, sectors: ["restaurante", "hosteleria"], submitUrl: "https://www.eltenedor.es/restaurant-registration", homeUrl: "https://www.eltenedor.es" },
  { slug: "doctoralia", name: "Doctoralia", country: "ES", authority: 72, sectors: ["salud", "clinica", "dental", "fisioterapia"], submitUrl: "https://www.doctoralia.es/registrarse-profesional", homeUrl: "https://www.doctoralia.es" },
  { slug: "milanuncios", name: "Milanuncios (Empresas)", country: "ES", authority: 58, sectors: ["servicios", "reformas", "automocion"], submitUrl: "https://www.milanuncios.com", homeUrl: "https://www.milanuncios.com" },
  { slug: "habitissimo", name: "Habitissimo", country: "ES", authority: 62, sectors: ["reformas", "servicios", "hogar"], submitUrl: "https://www.habitissimo.es/profesionales", homeUrl: "https://www.habitissimo.es" },
  { slug: "cylex-es", name: "Cylex España", country: "ES", authority: 50, sectors: [], submitUrl: "https://www.cylex.es/agregar-empresa.html", homeUrl: "https://www.cylex.es" },
  { slug: "infoisinfo", name: "infoisinfo", country: "ES", authority: 48, sectors: [], submitUrl: "https://www.infoisinfo.es/add_company.html", homeUrl: "https://www.infoisinfo.es" },
  { slug: "que-negocio", name: "QuéNegocio (Hoteles/Locales)", country: "ES", authority: 46, sectors: [], submitUrl: "https://www.quenegocio.es", homeUrl: "https://www.quenegocio.es" }
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Directorios recomendados para un sector (generalistas + los del sector), ordenados por autoridad. */
export function recommendDirectories(sector?: string | null): Directory[] {
  const sec = norm(sector ?? "");
  return DIRECTORIES.filter((d) => d.sectors.length === 0 || (sec && d.sectors.some((s) => sec.includes(norm(s)) || norm(s).includes(sec)))).sort((a, b) => b.authority - a.authority);
}

export function directoryBySlug(slug: string): Directory | undefined {
  return DIRECTORIES.find((d) => d.slug === slug);
}
