/**
 * Catálogo del panel de administración + lógica de acceso granular.
 *
 * FUENTE DE VERDAD de las CLAVES de acceso (ids de sección + hrefs de
 * tarjeta). El render visual (iconos, descripciones, estilos) vive en
 * components/admin/AdminConsole.tsx; este módulo es puro-datos para que
 * pueda importarse tanto en servidor (layout/API de enforcement) como en
 * cliente (consola y editor de permisos) sin arrastrar iconos.
 *
 * Si añades una tarjeta nueva al panel, añádela TAMBIÉN aquí con su
 * sectionId para que sea concedible. (Si falta aquí, simplemente no se
 * podrá conceder a miembros — fallo seguro: queda admin-only de facto.)
 *
 * Modelo de permisos (Membership.adminGrants):
 *   { sections: string[]; cards: string[] }
 *   - sections: ids de sección → concede TODAS sus tarjetas concedibles
 *     (incluidas futuras tarjetas que se añadan a esa sección).
 *   - cards: hrefs sueltos → concede esa tarjeta en concreto.
 *   - Los ADMIN ignoran esto (ven todo). Las tarjetas adminOnly NUNCA se
 *     conceden por esta vía (gestión de usuarios, bóveda de secretos, etc.).
 */

export type AdminSectionMeta = { id: string; title: string };
export type AdminCardMeta = {
  href: string;
  title: string;
  sectionId: string;
  /** Estrictamente ADMIN: nunca se concede a miembros ni aparece como concedible. */
  adminOnly?: boolean;
  /** Enlace externo / fuera de /admin: la visibilidad de la tarjeta se controla
   *  aquí, pero el destino tiene su propia autorización. */
  external?: boolean;
};

export const ADMIN_SECTIONS: AdminSectionMeta[] = [
  { id: "sonia", title: "Sonia — IA autónoma" },
  { id: "ia", title: "IA & Herramientas" },
  { id: "workspace", title: "Workspace & equipo" },
  { id: "comms", title: "Comunicación & clientes" },
  { id: "facturacion", title: "Facturación" },
  { id: "imports", title: "Importaciones & migraciones" },
  { id: "security", title: "Seguridad & auditoría" },
  { id: "maint", title: "Mantenimiento" }
];

export const ADMIN_CARDS: AdminCardMeta[] = [
  // sonia
  { href: "/admin/sonia-dashboard", title: "Dashboard de Sonia", sectionId: "sonia" },
  { href: "/admin/sonia-trust", title: "Trust por cliente", sectionId: "sonia" },
  { href: "/admin/nv-ia", title: "Configuración de Sonia", sectionId: "sonia" },
  { href: "/admin/sonia-knowledge", title: "Conocimiento de Sonia", sectionId: "sonia" },
  { href: "/admin/sonia-voice-test", title: "Voz de Sonia (ElevenLabs)", sectionId: "sonia" },
  { href: "/admin/sonia-self-heal", title: "Auto-fix de Sonia", sectionId: "sonia", adminOnly: true },
  { href: "/admin/make-settings", title: "Make.com (automatizaciones)", sectionId: "sonia" },
  { href: "/admin/sonia-lessons", title: "Lecciones aprendidas", sectionId: "sonia" },
  { href: "/admin/memoria-claude", title: "Memoria del proyecto", sectionId: "sonia" },
  // ia
  { href: "/admin/ai", title: "Configuración de IA", sectionId: "ia" },
  { href: "/admin/redactor", title: "Redactor IA", sectionId: "ia" },
  { href: "/admin/reviews", title: "Generador de reseñas IA", sectionId: "ia" },
  { href: "/admin/voice-reviews", title: "Voice Reviews", sectionId: "ia" },
  { href: "/admin/editorial", title: "Calendario editorial", sectionId: "ia" },
  { href: "/admin/bubui", title: "Bubui · Directorio SEO", sectionId: "ia" },
  { href: "/admin/subvenciones", title: "Cazador de Subvenciones IA", sectionId: "ia" },
  { href: "/admin/busqueda", title: "Búsqueda semántica", sectionId: "ia" },
  { href: "/admin/ia-usage", title: "Consumo de IA", sectionId: "ia" },
  // workspace
  { href: "/admin/personalizar", title: "Personalizar Hub", sectionId: "workspace" },
  { href: "/admin/usuarios", title: "Usuarios y permisos", sectionId: "workspace", adminOnly: true },
  { href: "/admin/proyectos", title: "Proyectos y acceso", sectionId: "workspace" },
  { href: "/admin/plataformas", title: "Plataformas", sectionId: "workspace" },
  { href: "/admin/columnas", title: "Columnas del Kanban", sectionId: "workspace" },
  { href: "/admin/task-templates", title: "Plantillas de tareas", sectionId: "workspace" },
  { href: "/admin/workspace", title: "Identidad del workspace", sectionId: "workspace" },
  { href: "/admin/notificaciones", title: "Notificaciones", sectionId: "workspace" },
  // comms
  { href: "/gmb-hub", title: "GMB Hub", sectionId: "comms", external: true },
  { href: "/admin/voz", title: "Llamadas de voz (Sonia)", sectionId: "comms" },
  { href: "/admin/leads", title: "Leads (NV Leads Pro)", sectionId: "comms" },
  { href: "/admin/entregables", title: "Entregables", sectionId: "comms" },
  { href: "/admin/webhooks", title: "Webhooks salientes", sectionId: "comms" },
  { href: "/perfil#gcal", title: "Google Calendar", sectionId: "comms", external: true },
  { href: "/admin/integrations/google-sheets", title: "Google Sheets (gspread)", sectionId: "comms" },
  { href: "/admin/extension", title: "Extensión de Chrome", sectionId: "comms" },
  // facturacion
  { href: "/facturacion", title: "Facturación", sectionId: "facturacion", external: true },
  { href: "/admin/integrations/holded", title: "Holded (contabilidad)", sectionId: "facturacion" },
  // imports
  { href: "/admin/asana", title: "Migración desde Asana", sectionId: "imports" },
  { href: "/admin/wp-import", title: "Importar desde WordPress", sectionId: "imports" },
  { href: "/admin/import", title: "Importar clientes y facturas", sectionId: "imports" },
  { href: "/admin/import-clients-list", title: "Importar listado de clientes", sectionId: "imports" },
  { href: "/admin/import-accesos", title: "Importar accesos desde tarea", sectionId: "imports", adminOnly: true },
  { href: "/admin/import-accesos-asana", title: "Importar accesos desde Asana", sectionId: "imports", adminOnly: true },
  // security
  { href: "/admin/api-keys", title: "API keys", sectionId: "security", adminOnly: true },
  { href: "/admin/seguridad", title: "Seguridad y copias", sectionId: "security", adminOnly: true },
  { href: "/admin/infraestructura", title: "Infraestructura y backups", sectionId: "security", adminOnly: true },
  { href: "/admin/secretos", title: "Bóveda de credenciales", sectionId: "security", adminOnly: true },
  { href: "/perfil/correo", title: "Mi correo", sectionId: "security", external: true },
  { href: "/admin/auditoria", title: "Auditoría", sectionId: "security", adminOnly: true },
  { href: "/admin/papelera", title: "Papelera", sectionId: "security", adminOnly: true },
  { href: "/admin/errors", title: "Errores capturados", sectionId: "security" },
  // maint
  {
    href: "https://claude.ai/code/session_0176NZVYVByJWdJ3qvH85bnb",
    title: "Sesión de Claude (mantenimiento)",
    sectionId: "maint",
    external: true
  }
];

export type AdminGrants = { sections: string[]; cards: string[] };

/** Normaliza el JSON crudo de Membership.adminGrants a una forma segura. */
export function normalizeAdminGrants(raw: unknown): AdminGrants {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const sections = Array.isArray(obj.sections)
    ? obj.sections.filter((x): x is string => typeof x === "string")
    : [];
  const cards = Array.isArray(obj.cards) ? obj.cards.filter((x): x is string => typeof x === "string") : [];
  return { sections, cards };
}

/** Tarjetas concedibles (no adminOnly) de una sección. */
export function grantableCardsBySection(sectionId: string): AdminCardMeta[] {
  return ADMIN_CARDS.filter((c) => c.sectionId === sectionId && !c.adminOnly);
}

/** ¿La sección tiene alguna tarjeta concedible? (las 100% adminOnly no se ofrecen) */
export function sectionIsGrantable(sectionId: string): boolean {
  return grantableCardsBySection(sectionId).length > 0;
}

export type AdminAccess = { all: boolean; hrefs: Set<string> };

/** Acceso efectivo de un miembro: ADMIN = todo; resto = unión de secciones + tarjetas concedidas. */
export function effectiveAdminAccess(role: string, rawGrants: unknown): AdminAccess {
  if (role === "ADMIN") return { all: true, hrefs: new Set(ADMIN_CARDS.map((c) => c.href)) };
  const g = normalizeAdminGrants(rawGrants);
  const hrefs = new Set<string>();
  for (const c of ADMIN_CARDS) {
    if (c.adminOnly) continue;
    if (g.sections.includes(c.sectionId) || g.cards.includes(c.href)) hrefs.add(c.href);
  }
  return { all: false, hrefs };
}

export function hasAnyAdminAccess(access: AdminAccess): boolean {
  return access.all || access.hrefs.size > 0;
}

/**
 * ¿Puede el usuario abrir esta ruta del panel? Solo gobierna rutas /admin/*.
 * Para subrutas (p. ej. /admin/nv-ia/drafts) basta tener concedida la
 * tarjeta padre (/admin/nv-ia). Las rutas /admin/* sin tarjeta en el catálogo
 * quedan denegadas a miembros (solo ADMIN) — fallo seguro.
 */
export function canAccessAdminPath(access: AdminAccess, pathname: string): boolean {
  if (access.all) return true;
  if (pathname === "/admin" || pathname === "/admin/") return access.hrefs.size > 0;
  for (const href of access.hrefs) {
    if (!href.startsWith("/admin")) continue;
    if (pathname === href || pathname.startsWith(href + "/")) return true;
  }
  return false;
}
