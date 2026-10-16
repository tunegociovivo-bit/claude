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
  // Enrutar SOLO este portal por RADAR_PROXY_URL (proxy residencial), para los
  // que bloquean la IP de centro de datos (Cloudflare, etc.). El resto sale directo.
  proxy?: boolean;
  // Marcar la casilla de "acepto condiciones" en el login cuando el portal la
  // exige para entrar (autorizado por el cliente portal a portal).
  acceptTerms?: boolean;
  notes?: string;
};

export const PORTALS: PortalDef[] = [
  {
    key: "auto1",
    name: "AUTO1.com",
    hosts: ["auto1.com"],
    // El listado de comprador exige el login de MERCHANT: /es/login dejaba el
    // listado redirigiendo a /es/merchant/signin (falso positivo de sesión).
    loginUrl: "https://www.auto1.com/es/merchant/signin",
    listingUrls: ["https://www.auto1.com/es/car-search", "https://www.auto1.com/es/auction"],
    // Marcadores estrictos: la página de signin es /merchant/signin, así que NO
    // se usa la URL (daría falso positivo); solo enlace de salir / texto de sesión.
    loggedIn: { selectors: ["a[href*='logout' i]", "a[href*='signout' i]"], textIncludes: ["Cerrar sesión", "Mis pujas", "Mis favoritos"] },
    defaultCountry: null,
    apiPathIncludes: ["/search", "/catalog", "/auction", "/api", "/lot", "/vehicle"],
  },
  {
    key: "autobiz",
    name: "Autobiz",
    hosts: ["autobiz.com", "autobiz.es"],
    loginUrl: "https://office-connect.autobiz.com/es/",
    listingUrls: ["https://office.autobiz.com/autobiztrade/", "https://office.autobiz.com/sourcing/"],
    loggedIn: { urlIncludes: ["office.autobiz.com", "office-connect.autobiz.com"], selectors: ["a[href*='logout' i]"], textIncludes: ["Déconnexion", "Cerrar sesión"] },
    defaultCountry: null,
    notes: "Login Auth0 vía office-connect.autobiz.com/es/. Panel office.autobiz.com con módulos; el de compra B2B es autobizTrade (probar también Sourcing). Confirmar con el diagnóstico qué módulo lista coches.",
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
    listingUrls: ["https://carmarket.ayvens.com/es-es/lots", "https://carmarket.ayvens.com/es-es/"],
    loggedIn: { urlIncludes: ["/es-es"], selectors: ["a[href*='logout' i]", "[class*='myAccount' i]"], textIncludes: ["Mis favoritos", "Cerrar sesión", "Ventas EN VIVO"] },
    defaultCountry: null,
    apiPathIncludes: ["graphql", "/saleevents", "/lots", "/api", "/search", "/lot", "/vehicle", "/catalog", "/auction", "/subasta"],
    notes: "Datos vía API GraphQL api-carmarket.ayvens.com/graphql/saleevents. /es-es/ ya da coches; /es-es/lots es el listado completo. Logueado: «Mis favoritos», «Ventas EN VIVO».",
  },
  {
    key: "bca",
    name: "BCA",
    hosts: ["bca.com", "bca.es", "bca.co.uk"],
    loginUrl: "https://login.bca.com/login",
    listingUrls: ["https://www.bca.es/buscar", "https://www.bca.com/en/search"],
    loggedIn: { selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Logout", "Mi BCA"] },
    defaultCountry: "ES",
    proxy: true,
    apiPathIncludes: ["/api", "/search", "/vehicle", "/lot"],
    notes: "login.bca.com/login genera el token solo y redirige a login.bca.co.uk (IdentityServer AngularJS); acceso en 2 pasos (usuario→Siguiente→contraseña). Tras entrar redirige al portal del país.",
  },
  {
    key: "openlane",
    name: "OPENLANE",
    hosts: ["openlane.eu", "openlane.com"],
    loginUrl: "https://www.openlane.eu/es/findcar",
    listingUrls: ["https://www.openlane.eu/es/findcar"],
    loggedIn: { selectors: ["a[href*='logout' i]", "[class*='account' i]"], textIncludes: ["Cerrar sesión", "Logout", "Mi cuenta"] },
    defaultCountry: null,
    apiPathIncludes: ["/findcarv6/search", "/api", "/search", "/vehicle", "/catalog"],
    notes: "SPA v6. El login es un modal: hay que pulsar «Acceder» y luego es acceso en 2 pasos (usuario→contraseña). El listado se lee por POST /en/findcarv6/search.",
  },
  {
    key: "arval",
    name: "Arval Remarketing",
    hosts: ["remktg.arval.com", "arval.com"],
    loginUrl: "https://remktg.arval.com/buyer/#/login",
    listingUrls: ["https://remktg.arval.com/buyer/#/sales-events", "https://remktg.arval.com/buyer/#/buy-now"],
    loggedIn: { urlIncludes: ["#/sales-events", "#/buy-now", "#/ongoing", "#/awarded", "#/home", "#/vehicles", "#/dashboard"], selectors: ["a[href*='logout' i]"], textIncludes: ["Sales Events", "Buy Now", "Awarded vehicles", "Ongoing negotiations", "Cerrar sesión"] },
    defaultCountry: "ES",
    apiPathIncludes: ["/api", "/vehicle", "/catalog", "/search", "/lot", "/sales", "/event", "/buy"],
    notes: "SPA (MotorTrade). El dominio bueno es remktg.arval.com. Tras login aterriza en /buyer/#/sales-events (logueado: «Sales Events», «Buy Now», «Awarded vehicles»).",
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
    acceptTerms: true,
    apiPathIncludes: ["/api", "/vehicle", "/search", "/lot", "/subasta"],
  },
  {
    key: "fstools",
    name: "RemaMobile (fs-tools)",
    hosts: ["fs-tools.es"],
    loginUrl: "https://www.fs-tools.es/RemaMobile/#/",
    listingUrls: ["https://www.fs-tools.es/RemaMobile/#/vehicles", "https://www.fs-tools.es/RemaMobile/#/list"],
    loggedIn: { urlIncludes: ["#/home", "#/vehicles", "#/list"], selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Salir"] },
    defaultCountry: "ES",
    proxy: true,
    apiPathIncludes: ["/api", "/vehicle", "/rema", "/search", "/lot"],
    notes: "REMA 4.0 (VWFS España). El apex fs-tools.es NO resuelve; usar www.fs-tools.es. Form UserId/Password, botón ENTRAR. Confirmar la ruta de la lista tras entrar.",
  },
  {
    key: "secondmove",
    name: "2ndMove",
    hosts: ["2ndmove.eu", "b2b.2ndmove.eu"],
    loginUrl: "https://b2b.2ndmove.eu/es/login",
    listingUrls: ["https://b2b.2ndmove.eu/es/auction", "https://b2b.2ndmove.eu/es/home"],
    loggedIn: { urlIncludes: ["/es/home", "/home", "/es/auction"], selectors: ["a[href*='logout' i]"], textIncludes: ["Cerrar sesión", "Mi cuenta", "Datos personales"] },
    defaultCountry: null,
    apiPathIncludes: ["/api", "/vehicle", "/search", "/catalog", "/auction", "/lot"],
    notes: "Inicia sesión y aterriza en /es/home; el listado es /es/auction (el enlace «Vehículos»). Confirmar su API con el diagnóstico.",
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
