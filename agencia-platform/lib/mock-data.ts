/**
 * Status es ahora libre porque las columnas del kanban se configuran por
 * workspace en /admin/columnas. Los IDs por defecto son TODO/IN_PROGRESS/
 * REVIEW/DONE (compatibilidad con datos preexistentes). Hay helpers
 * statusLabelOf / statusColorOf más abajo para mostrarlos.
 */
export type Status = string;

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: string;
  color: string;
  image?: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  status: Status;
  assigneeIds: string[];
  clientId?: string;
  projectId: string;
  dueDate: string;
  priority: "baja" | "media" | "alta";
  tags: string[];
};

export type Project = {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description: string;
  progress: number;
};

export type Client = {
  id: string;
  name: string;
  industry: string;
  contactName: string;
  email: string;
  phone: string;
  status: "activo" | "pausa" | "prospecto";
  mrr: number;
  since: string;
  notes: string;
};

export type DocPage = {
  id: string;
  title: string;
  icon: string;
  category: string;
  updatedAt: string;
  author: string;
  excerpt: string;
  blocks: { type: "heading" | "paragraph" | "list" | "callout"; text: string | string[] }[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time?: string;
  type: "publicacion" | "reunion" | "deadline" | "campaña";
  clientId?: string;
};

export const team: TeamMember[] = [
  { id: "u1", name: "Lucía Fernández", initials: "LF", role: "Directora", color: "bg-rose-500" },
  { id: "u2", name: "Marcos Vidal", initials: "MV", role: "Account Manager", color: "bg-indigo-500" },
  { id: "u3", name: "Ana Pereira", initials: "AP", role: "Diseñadora", color: "bg-emerald-500" },
  { id: "u4", name: "Diego Romero", initials: "DR", role: "Copywriter", color: "bg-amber-500" },
  { id: "u5", name: "Sara Molina", initials: "SM", role: "Social Media", color: "bg-sky-500" },
  { id: "u6", name: "Pablo Ruiz", initials: "PR", role: "Performance", color: "bg-purple-500" }
];

export const clients: Client[] = [
  {
    id: "c1",
    name: "Nordic Coffee Co.",
    industry: "Hostelería",
    contactName: "Elena Sjögren",
    email: "elena@nordiccoffee.com",
    phone: "+34 600 123 456",
    status: "activo",
    mrr: 2400,
    since: "2024-02-12",
    notes: "Cliente clave. Foco en branding y campañas locales."
  },
  {
    id: "c2",
    name: "Atelier Marta Lago",
    industry: "Moda",
    contactName: "Marta Lago",
    email: "marta@atelierlago.es",
    phone: "+34 611 222 333",
    status: "activo",
    mrr: 1800,
    since: "2023-09-04",
    notes: "Lanzamiento de colección otoño en octubre."
  },
  {
    id: "c3",
    name: "Clínica Veterinaria Patas",
    industry: "Salud animal",
    contactName: "Dr. Iván Castro",
    email: "ivan@patas.vet",
    phone: "+34 622 555 999",
    status: "activo",
    mrr: 950,
    since: "2024-11-20",
    notes: "Quieren añadir SEO local."
  },
  {
    id: "c4",
    name: "Inmobiliaria Costa Verde",
    industry: "Inmobiliaria",
    contactName: "Pedro Salas",
    email: "pedro@costaverde.com",
    phone: "+34 633 777 222",
    status: "pausa",
    mrr: 0,
    since: "2023-03-01",
    notes: "Pausa hasta junio por restructuración interna."
  },
  {
    id: "c5",
    name: "Tech Sprint Academy",
    industry: "Educación",
    contactName: "Nora Bermúdez",
    email: "nora@techsprint.io",
    phone: "+34 644 888 111",
    status: "prospecto",
    mrr: 0,
    since: "2026-04-28",
    notes: "Propuesta enviada, esperando feedback."
  }
];

export const projects: Project[] = [
  {
    id: "p1",
    name: "Rebranding Nordic Coffee",
    clientId: "c1",
    color: "bg-rose-500",
    description: "Renovación de identidad visual y manual de marca.",
    progress: 62
  },
  {
    id: "p2",
    name: "Campaña Otoño Atelier",
    clientId: "c2",
    color: "bg-indigo-500",
    description: "Lanzamiento colección otoño con paid + orgánico.",
    progress: 35
  },
  {
    id: "p3",
    name: "SEO Local Patas",
    clientId: "c3",
    color: "bg-emerald-500",
    description: "Optimización Google Business + fichas locales.",
    progress: 18
  },
  {
    id: "p4",
    name: "Embudo Tech Sprint",
    clientId: "c5",
    color: "bg-amber-500",
    description: "Diseño de funnel para captación de alumnos.",
    progress: 5
  }
];

export const tasks: Task[] = [
  {
    id: "t1",
    title: "Definir paleta cromática secundaria",
    status: "IN_PROGRESS",
    assigneeIds: ["u3"],
    projectId: "p1",
    clientId: "c1",
    dueDate: "2026-05-18",
    priority: "alta",
    tags: ["branding", "diseño"]
  },
  {
    id: "t2",
    title: "Redactar copy email lanzamiento",
    status: "TODO",
    assigneeIds: ["u4"],
    projectId: "p2",
    clientId: "c2",
    dueDate: "2026-05-20",
    priority: "media",
    tags: ["copywriting"]
  },
  {
    id: "t3",
    title: "Programar publicaciones IG semana 21",
    status: "TODO",
    assigneeIds: ["u5"],
    projectId: "p2",
    clientId: "c2",
    dueDate: "2026-05-17",
    priority: "alta",
    tags: ["social", "instagram"]
  },
  {
    id: "t4",
    title: "Optimizar ficha Google Business",
    status: "REVIEW",
    assigneeIds: ["u6", "u4"],
    projectId: "p3",
    clientId: "c3",
    dueDate: "2026-05-16",
    priority: "alta",
    tags: ["seo", "local"]
  },
  {
    id: "t5",
    title: "Crear landing page del curso",
    status: "TODO",
    assigneeIds: ["u3", "u6"],
    projectId: "p4",
    clientId: "c5",
    dueDate: "2026-05-30",
    priority: "media",
    tags: ["landing", "funnel"]
  },
  {
    id: "t6",
    title: "Entregar manual de marca v1",
    status: "REVIEW",
    assigneeIds: ["u3"],
    projectId: "p1",
    clientId: "c1",
    dueDate: "2026-05-22",
    priority: "media",
    tags: ["entregable"]
  },
  {
    id: "t7",
    title: "Reunión kick-off Tech Sprint",
    status: "DONE",
    assigneeIds: ["u1", "u2"],
    projectId: "p4",
    clientId: "c5",
    dueDate: "2026-05-12",
    priority: "media",
    tags: ["reunión"]
  },
  {
    id: "t8",
    title: "Auditoría de competencia Patas",
    status: "DONE",
    assigneeIds: ["u6"],
    projectId: "p3",
    clientId: "c3",
    dueDate: "2026-05-10",
    priority: "baja",
    tags: ["seo"]
  },
  {
    id: "t9",
    title: "Mockups packaging Nordic",
    status: "IN_PROGRESS",
    assigneeIds: ["u3"],
    projectId: "p1",
    clientId: "c1",
    dueDate: "2026-05-25",
    priority: "alta",
    tags: ["diseño", "packaging"]
  },
  {
    id: "t10",
    title: "Plan de medios mayo Atelier",
    status: "IN_PROGRESS",
    assigneeIds: ["u6", "u2"],
    projectId: "p2",
    clientId: "c2",
    dueDate: "2026-05-19",
    priority: "alta",
    tags: ["paid", "ads"]
  }
];

export const docs: DocPage[] = [
  {
    id: "d1",
    title: "Manual de marca interno",
    icon: "FileText",
    category: "Procesos",
    updatedAt: "2026-05-10",
    author: "Lucía Fernández",
    excerpt: "Lineamientos visuales y de tono para todos los proyectos internos.",
    blocks: [
      { type: "heading", text: "Identidad visual" },
      { type: "paragraph", text: "Esta guía resume los elementos de marca aplicables tanto a comunicación interna como a propuestas comerciales." },
      { type: "list", text: ["Logotipo principal y variantes monocromas", "Paleta tipográfica: Inter y Fraunces", "Uso de iconografía Lucide"] },
      { type: "callout", text: "Cualquier excepción a estos lineamientos requiere validación de la dirección creativa." }
    ]
  },
  {
    id: "d2",
    title: "Plantilla de propuesta comercial",
    icon: "FileSignature",
    category: "Comercial",
    updatedAt: "2026-05-08",
    author: "Marcos Vidal",
    excerpt: "Estructura base para enviar propuestas a nuevos clientes.",
    blocks: [
      { type: "heading", text: "Estructura recomendada" },
      { type: "list", text: ["Resumen ejecutivo", "Diagnóstico inicial", "Servicios propuestos", "Inversión y entregables", "Próximos pasos"] },
      { type: "paragraph", text: "Mantener un tono cercano y evitar tecnicismos innecesarios." }
    ]
  },
  {
    id: "d3",
    title: "Onboarding nuevos clientes",
    icon: "Users",
    category: "Procesos",
    updatedAt: "2026-05-04",
    author: "Marcos Vidal",
    excerpt: "Checklist y rituales para los primeros 30 días con un cliente.",
    blocks: [
      { type: "heading", text: "Primera semana" },
      { type: "list", text: ["Kick-off interno", "Acceso a canales y herramientas", "Auditoría inicial", "Calendario de hitos"] },
      { type: "heading", text: "Mes 1" },
      { type: "list", text: ["Primer informe", "Reunión mensual de revisión"] }
    ]
  },
  {
    id: "d4",
    title: "SOP - Publicaciones en Instagram",
    icon: "Sparkles",
    category: "Operaciones",
    updatedAt: "2026-04-30",
    author: "Sara Molina",
    excerpt: "Proceso estándar para programar y revisar contenido en IG.",
    blocks: [
      { type: "heading", text: "Flujo de aprobación" },
      { type: "list", text: ["Borrador en Notion interno", "Revisión copy", "Revisión creatividad", "Aprobación cliente", "Programación en Meta Business"] }
    ]
  }
];

export const events: CalendarEvent[] = [
  { id: "e1", title: "Publicación reel Nordic", date: "2026-05-14", time: "11:00", type: "publicacion", clientId: "c1" },
  { id: "e2", title: "Reunión semanal Atelier", date: "2026-05-14", time: "16:00", type: "reunion", clientId: "c2" },
  { id: "e3", title: "Deadline manual de marca", date: "2026-05-22", type: "deadline", clientId: "c1" },
  { id: "e4", title: "Lanzamiento campaña otoño", date: "2026-05-28", type: "campaña", clientId: "c2" },
  { id: "e5", title: "Auditoría inicial Patas", date: "2026-05-16", time: "10:00", type: "reunion", clientId: "c3" },
  { id: "e6", title: "Publicación blog SEO local", date: "2026-05-19", time: "09:00", type: "publicacion", clientId: "c3" },
  { id: "e7", title: "Kick-off Tech Sprint", date: "2026-05-12", time: "12:00", type: "reunion", clientId: "c5" },
  { id: "e8", title: "Entrega landing Tech Sprint", date: "2026-05-30", type: "deadline", clientId: "c5" }
];

/**
 * Labels y colores por defecto. Los nuevos workspaces pueden añadir columnas
 * con sus propios labels/colores y se mezclan vía statusLabelOf/Color en
 * tiempo de render.
 */
export const statusLabels: Record<string, string> = {
  // Mayúsculas (lo que viene de BD ahora):
  TODO: "Por hacer",
  IN_PROGRESS: "En curso",
  REVIEW: "Revisión",
  DONE: "Hecho",
  CANCELLED: "Cancelada",
  // Compatibilidad lowercase (legacy):
  todo: "Por hacer",
  in_progress: "En curso",
  review: "Revisión",
  done: "Hecho"
};

export const statusColors: Record<string, string> = {
  TODO: "bg-slate-100 text-slate-700 border-slate-200",
  IN_PROGRESS: "bg-indigo-50 text-indigo-700 border-indigo-200",
  REVIEW: "bg-amber-50 text-amber-800 border-amber-200",
  DONE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
  todo: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-indigo-50 text-indigo-700 border-indigo-200",
  review: "bg-amber-50 text-amber-800 border-amber-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200"
};

/**
 * Helpers que consultan primero la config dinámica de columnas del workspace
 * (si se pasa) y caen a los defaults arriba.
 */
type ColumnLike = { id: string; label?: string; color?: string };
export function statusLabelOf(status: string, columns?: ColumnLike[]): string {
  const col = columns?.find((c) => c.id === status);
  if (col?.label) return col.label;
  return statusLabels[status] ?? status;
}
export function statusColorOf(status: string, columns?: ColumnLike[]): string {
  const col = columns?.find((c) => c.id === status);
  if (col?.color) return col.color;
  return statusColors[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

export const priorityColors: Record<Task["priority"], string> = {
  baja: "bg-slate-100 text-slate-600",
  media: "bg-sky-100 text-sky-700",
  alta: "bg-rose-100 text-rose-700"
};

export function getClient(id?: string) {
  return clients.find((c) => c.id === id);
}
export function getProject(id?: string) {
  return projects.find((p) => p.id === id);
}
export function getMember(id?: string) {
  return team.find((m) => m.id === id);
}
