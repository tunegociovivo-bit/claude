import type {
  MobileAutomationPlatform,
  MobileAutomationSourceKind
} from "@/lib/mobile/automation-policy";

export type MobileAutomationWorkflow = {
  sourceKind: MobileAutomationSourceKind;
  label: string;
  description: string;
  targetNameLabel: string;
  targetNamePlaceholder: string;
  targetUrlLabel: string | null;
  targetUrlPlaceholder: string | null;
  factsLabel: string;
  factsPlaceholder: string;
  submitLabel: string;
};

const COMMON_POST: MobileAutomationWorkflow = {
  sourceKind: "OWNED_POST",
  label: "Crear una publicación",
  description: "Prepara una publicación para una cuenta que gestionas.",
  targetNameLabel: "Tema de la publicación",
  targetNamePlaceholder: "Ej. nueva guía de IA para pymes",
  targetUrlLabel: "Perfil o página donde publicar",
  targetUrlPlaceholder: "https://…",
  factsLabel: "Contenido e instrucciones",
  factsPlaceholder: "Objetivo, datos que deben aparecer, tono y llamada a la acción.",
  submitLabel: "Preparar publicación"
};

const COMMON_LINK: MobileAutomationWorkflow = {
  sourceKind: "LINK_SHARE",
  label: "Compartir un enlace",
  description: "Prepara el texto y abre el destino donde quieres compartirlo.",
  targetNameLabel: "Nombre del enlace o campaña",
  targetNamePlaceholder: "Ej. artículo sobre automatización",
  targetUrlLabel: "Destino donde compartir",
  targetUrlPlaceholder: "https://…",
  factsLabel: "Enlace y contexto real",
  factsPlaceholder: "Qué compartes, por qué es útil y a quién va dirigido.",
  submitLabel: "Preparar enlace"
};

const COMMENT_DISCOVERY: MobileAutomationWorkflow = {
  sourceKind: "COMMENT_DISCOVERY",
  label: "Detectar conversaciones relevantes",
  description: "Abre una comunidad o publicación y prepara los criterios que usará el Radar.",
  targetNameLabel: "Temática a detectar",
  targetNamePlaceholder: "Ej. negocios que preguntan por automatización con IA",
  targetUrlLabel: "Grupo, perfil o publicación",
  targetUrlPlaceholder: "https://…",
  factsLabel: "Criterios de relevancia",
  factsPlaceholder: "Palabras clave, necesidades que interesan y conversaciones que deben excluirse.",
  submitLabel: "Preparar detección"
};

const COMMENT_REPLY: MobileAutomationWorkflow = {
  sourceKind: "COMMENT_REPLY",
  label: "Responder comentarios",
  description: "Genera una respuesta distinta y contextual para una conversación concreta.",
  targetNameLabel: "Tema de la conversación",
  targetNamePlaceholder: "Ej. recomendación de herramientas de marketing",
  targetUrlLabel: "Publicación o conversación",
  targetUrlPlaceholder: "https://…",
  factsLabel: "Comentario y datos para responder",
  factsPlaceholder: "Pega el comentario y aporta los hechos, experiencia o respuesta que quieres comunicar.",
  submitLabel: "Generar respuesta"
};

const WORKFLOWS: Record<MobileAutomationPlatform, readonly MobileAutomationWorkflow[]> = {
  facebook: [
    {
      sourceKind: "GROUP_DISCOVERY",
      label: "Buscar grupos por sector o temática",
      description: "Abre una búsqueda de grupos ya preparada y usa tus criterios para revisarlos.",
      targetNameLabel: "Sector o temática",
      targetNamePlaceholder: "Ej. viajes a Japón, IA para pymes, marketing local",
      targetUrlLabel: null,
      targetUrlPlaceholder: null,
      factsLabel: "Criterios de selección",
      factsPlaceholder: "Ubicación, idioma, tamaño, actividad mínima y tipos de grupo que quieres excluir.",
      submitLabel: "Buscar grupos"
    },
    {
      sourceKind: "GROUP_JOIN_REQUEST",
      label: "Preparar solicitudes para unirse a grupos",
      description: "Abre el grupo y prepara la presentación o respuestas de acceso con tus datos reales.",
      targetNameLabel: "Nombre del grupo",
      targetNamePlaceholder: "Ej. Viajar a Japón por libre",
      targetUrlLabel: "URL del grupo",
      targetUrlPlaceholder: "https://www.facebook.com/groups/…",
      factsLabel: "Motivo y datos para la solicitud",
      factsPlaceholder: "Por qué te interesa el grupo y qué información real debe incluir la solicitud.",
      submitLabel: "Preparar solicitud"
    },
    COMMENT_DISCOVERY,
    COMMENT_REPLY,
    COMMON_POST,
    COMMON_LINK
  ],
  instagram: [COMMENT_DISCOVERY, COMMENT_REPLY, COMMON_POST, COMMON_LINK],
  tiktok: [COMMENT_DISCOVERY, COMMENT_REPLY, COMMON_POST, COMMON_LINK],
  google_maps: [{
    sourceKind: "REAL_REVIEW",
    label: "Reseñar una experiencia real",
    description: "Redacta una reseña basada exclusivamente en una visita real.",
    targetNameLabel: "Nombre del lugar",
    targetNamePlaceholder: "Ej. Restaurante Ejemplo",
    targetUrlLabel: "Ficha de Google Maps",
    targetUrlPlaceholder: "https://www.google.com/maps/place/…",
    factsLabel: "Hechos de la experiencia",
    factsPlaceholder: "Cuándo fuiste, qué probaste y qué valoras, sin inventar detalles.",
    submitLabel: "Generar reseña"
  }],
  generic: [COMMON_LINK]
};

export function getAutomationWorkflows(platform: MobileAutomationPlatform): readonly MobileAutomationWorkflow[] {
  return WORKFLOWS[platform];
}

export function isAutomationWorkflowAllowed(
  platform: MobileAutomationPlatform,
  sourceKind: MobileAutomationSourceKind
): boolean {
  if (sourceKind === "GENUINE_COMMENT") {
    return platform === "facebook" || platform === "instagram" || platform === "tiktok";
  }
  return WORKFLOWS[platform].some((workflow) => workflow.sourceKind === sourceKind);
}

export function buildAutomationTargetUrl(
  platform: MobileAutomationPlatform,
  sourceKind: MobileAutomationSourceKind,
  targetName: string
): string | null {
  if (platform !== "facebook" || sourceKind !== "GROUP_DISCOVERY") return null;
  const url = new URL("https://www.facebook.com/search/groups/");
  url.searchParams.set("q", targetName.trim());
  return url.toString();
}
