// Catálogo de portales de subastas B2B. La URL de acceso, la URL de la lista de
// coches y cómo se sabe que la sesión está iniciada las fija el código (no el
// usuario): así un acceso manipulado no puede apuntar el navegador a otro sitio.
// Las credenciales de cada cliente se guardan cifradas en RadarSource.

export type PortalDef = {
  key: string;
  name: string;
  // Dominios del portal (para validar enlaces y filtrar respuestas JSON).
  hosts: string[];
  loginUrl: string;
  // Páginas de la lista de coches (con la sesión ya iniciada). La primera que
  // cargue bien se usa; se pueden poner varias (p. ej. compra directa + subasta).
  listingUrls: string[];
  // Señales en la página de que hay sesión: texto o selector.
  loggedIn: { urlIncludes?: string[]; selectors?: string[]; textIncludes?: string[] };
  defaultCountry?: string | null;
  // Solo quedarse con respuestas JSON de estas rutas (reduce ruido). Vacío = todas.
  apiPathIncludes?: string[];
  notes?: string;
};

export const PORTALS: PortalDef[] = [
  {
    key: "auto1",
    name: "AUTO1.com",
    hosts: ["auto1.com"],
    loginUrl: "https://www.auto1.com/es/login",
    listingUrls: ["https://www.auto1.com/es/car-search", "https://www.auto1.com/es/auction"],
    loggedIn: { selectors: ["[data-testid*='account' i]", "a[href*='logout' i]", "[class*='myAccount' i]"], textIncludes: ["Cerrar sesión", "Mi cuenta"] },
    defaultCountry: null,
    apiPathIncludes: ["/search", "/catalog", "/auction", "/api"],
  },
  {
    key: "autobiz",
    name: "Autobiz",
    hosts: ["autobiz.com", "autobiz.es"],
    loginUrl: "https://login-office.autobiz.com",
    listingUrls: ["https://office.autobiz.com"],
    loggedIn: { urlIncludes: ["office.autobiz.com"], selectors: ["a[href*='logout' i]"], textIncludes: ["Déconnexion", "Cerrar sesión"] },
    defaultCountry: null,
    notes: "El acceso de compradores puede estar bajo office.autobiz.com; confirmar la ruta de la lista tras entrar.",
  },
  {
    key: "autorola",
    name: "Autorola",
    hosts: ["autorola.es", "autorola.com"],
    loginUrl: "https://www.autorola.es/",
    listingUrls: ["https://www.autorola.es/profesional/vehiculos", "https://www.autorola.es/car/list"],
    loggedIn: { selectors: ["a[href*='logout' i]", "a[href*='logoff' i]"], textIncludes: ["Cerrar sesión", "Mis subastas", "Mi cuenta"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/car", "/vehicle", "/auction", "/api", "/search"],
  },
  {
    key: "ayvens",
    name: "Ayvens Carmarket",
    hosts: ["carmarket.ayvens.com", "ayvens.com"],
    loginUrl: "https://carmarket.ayvens.com/login",
    listingUrls: ["https://carmarket.ayvens.com/en/car-search", "https://carmarket.ayvens.com/en/lots"],
    loggedIn: { selectors: ["a[href*='logout' i]", "[class*='myAccount' i]"], textIncludes: ["Logout", "My account", "Mi cuenta"] },
    defaultCountry: null,
    apiPathIncludes: ["/api", "/search", "/lot", "/vehicle", "/catalog"],
    notes: "Carmarket usa buscador con parámetros; confirmar la ruta /car-search tras entrar.",
  },
  {
    key: "bca",
    name: "BCA",
    hosts: ["bca.com", "bca.es"],
    loginUrl: "https://login.bca.com/",
    listingUrls: ["https://www.bca.es/buscar", "https://www.bca.com/en/search"],
    loggedIn: { selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Logout", "Mi BCA"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/search", "/vehicle", "/lot"],
    notes: "Login en login.bca.com (IdentityServer); tras entrar redirige al portal del país.",
  },
  {
    key: "openlane",
    name: "OPENLANE",
    hosts: ["openlane.eu", "openlane.com"],
    loginUrl: "https://www.openlane.eu/es/login",
    listingUrls: ["https://www.openlane.eu/es/vehicles", "https://www.openlane.eu/en/vehicles"],
    loggedIn: { selectors: ["a[href*='logout' i]", "[class*='account' i]"], textIncludes: ["Cerrar sesión", "Logout", "Mi cuenta"] },
    defaultCountry: null,
    apiPathIncludes: ["/api", "/search", "/vehicle", "/catalog"],
  },
  {
    key: "arval",
    name: "Arval Remarketing",
    hosts: ["remktg.arval.com", "arval.com"],
    loginUrl: "https://remktg.arval.com/buyer/#/login",
    listingUrls: ["https://remktg.arval.com/buyer/#/vehicles", "https://remktg.arval.com/buyer/#/catalog"],
    loggedIn: { urlIncludes: ["#/home", "#/vehicles", "#/dashboard"], selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Logout"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/vehicle", "/catalog", "/search", "/lot"],
    notes: "SPA (MotorTrade). El documento ponía aryal.com por error: el dominio bueno es remktg.arval.com.",
  },
  {
    key: "bmw",
    name: "BMW Used Car Remarketing",
    hosts: ["bmwgroup.com", "bmw.com", "usedcars.bmw.com"],
    loginUrl: "https://customer.bmwgroup.com/oneid/#/login",
    listingUrls: ["https://usedcars.bmw.com/"],
    loggedIn: { urlIncludes: ["/portal", "/dashboard", "/home"], selectors: ["a[href*='logout' i]"], textIncludes: ["Abmelden", "Logout", "Cerrar sesión"] },
    defaultCountry: null,
    notes: "Acceso con BMW OneID. Falta el usuario en el documento; confirmar la ruta del remarketing tras entrar.",
  },
  {
    key: "manheim",
    name: "Manheim",
    hosts: ["manheim.es", "manheim.com"],
    loginUrl: "https://www.manheim.es/login",
    listingUrls: ["https://www.manheim.es/vehiculos", "https://www.manheim.es/subastas"],
    loggedIn: { selectors: ["a[href*='logout' i]", "a[href*='cerrar' i]"], textIncludes: ["Cerrar sesión", "Mi cuenta", "Mis subastas"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/vehicle", "/search", "/lot", "/subasta"],
  },
  {
    key: "fstools",
    name: "RemaMobile (fs-tools)",
    hosts: ["fs-tools.es"],
    loginUrl: "https://fs-tools.es/RemaMobile/#/",
    listingUrls: ["https://fs-tools.es/RemaMobile/#/vehicles", "https://fs-tools.es/RemaMobile/#/list"],
    loggedIn: { urlIncludes: ["#/home", "#/vehicles", "#/list"], selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Salir"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/vehicle", "/rema", "/search", "/lot"],
    notes: "SPA. Confirmar la ruta de la lista tras entrar.",
  },
  {
    key: "secondmove",
    name: "2ndMove",
    hosts: ["2ndmove.eu", "b2b.2ndmove.eu"],
    loginUrl: "https://b2b.2ndmove.eu/es/login",
    listingUrls: ["https://b2b.2ndmove.eu/es/vehiculos", "https://b2b.2ndmove.eu/es/home"],
    loggedIn: { selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Mi cuenta"] },
    defaultCountry: null,
    apiPathIncludes: ["/api", "/vehicle", "/search", "/catalog"],
  },
  {
    key: "santander",
    name: "Santander Used Cars",
    hosts: ["santanderusedcars.com"],
    loginUrl: "https://auth.santanderusedcars.com/login",
    listingUrls: ["https://www.santanderusedcars.com/vehiculos", "https://www.santanderusedcars.com/buscar"],
    loggedIn: { selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Mi cuenta", "Mis pujas"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/vehicle", "/search", "/lot"],
  },
];

// Solo para pruebas locales (nunca en producción): permite registrar portales
// ficticios a través de RADAR_TEST_PORTALS_JSON para el arnés de e2e.
function testPortals(): PortalDef[] {
  if (process.env.NODE_ENV === "production" || !process.env.RADAR_TEST_PORTALS_JSON) return [];
  try {
    const parsed = JSON.parse(process.env.RADAR_TEST_PORTALS_JSON);
    return Array.isArray(parsed) ? (parsed as PortalDef[]) : [];
  } catch {
    return [];
  }
}

const ALL_PORTALS: PortalDef[] = [...PORTALS, ...testPortals()];
const BY_KEY = new Map(ALL_PORTALS.map((p) => [p.key, p] as const));

export function getPortal(key: string): PortalDef | null {
  return BY_KEY.get(key) ?? null;
}

export function portalKeys(): string[] {
  return ALL_PORTALS.map((p) => p.key);
}

export function isPortalKey(value: unknown): value is string {
  return typeof value === "string" && BY_KEY.has(value);
}

/** ¿El enlace apunta a un dominio de ESTE portal? (para no guardar URLs ajenas) */
export function urlBelongsToPortal(portal: PortalDef, rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return portal.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export function jsonUrlFilterFor(portal: PortalDef): ((url: string) => boolean) | undefined {
  if (!portal.apiPathIncludes || portal.apiPathIncludes.length === 0) return undefined;
  const needles = portal.apiPathIncludes.map((n) => n.toLowerCase());
  return (url: string) => {
    const u = url.toLowerCase();
    return needles.some((n) => u.includes(n));
  };
}
