/**
 * Prompts del Publicador SEO. Centralizados para afinarlos sin tocar la lógica.
 */
import type { SeoBlogSite } from "@prisma/client";
import { asArray } from "./util";

export type SiteCtx = SeoBlogSite & { client: { name: string; brandBrief?: string | null; infoGeneral?: string | null; website?: string | null } };

const LANGS: Record<string, string> = {
  "es-ES": "español de España (castellano peninsular, sin latinoamericanismos)",
  "es-MX": "español de México",
  es: "español",
  "en-GB": "British English",
  "en-US": "American English",
  "de-DE": "Deutsch (Deutschland)",
  "fr-FR": "français",
  "it-IT": "italiano",
  "pt-PT": "português europeu",
  "ca-ES": "català"
};
export const langName = (code: string) => LANGS[code] ?? code;

export function clientContext(s: SiteCtx): string {
  const business = [s.businessInfo, s.client.brandBrief, s.client.infoGeneral].filter(Boolean).join("\n");
  const l: string[] = [`CLIENTE: ${s.client.name}`];
  if (s.siteUrl) l.push(`Web: ${s.siteUrl}`);
  if (s.sector) l.push(`Sector: ${s.sector}`);
  if (s.location) l.push(`Ubicación / zona de servicio: ${s.location}`);
  if (business) l.push(`Negocio (datos reales, los únicos que puedes afirmar): ${business}`);
  if (s.audience) l.push(`Público objetivo: ${s.audience}`);
  if (s.tone) l.push(`Tono: ${s.tone}`);
  if (s.brandVoice) l.push(`Voz de marca / cómo habla: ${s.brandVoice}`);
  if (s.compliance) l.push(`Restricciones legales y de cumplimiento (OBLIGATORIAS): ${s.compliance}`);
  if (s.forbidden) l.push(`Palabras/temas prohibidos: ${s.forbidden}`);
  if (s.ctaText) l.push(`Llamada a la acción preferida: ${s.ctaText}${s.ctaUrl ? ` → ${s.ctaUrl}` : ""}`);
  if (s.competitors) l.push(`Competidores (NUNCA enlazarlos ni citarlos): ${s.competitors}`);
  l.push(`Idioma de publicación: ${langName(s.language)}`);
  return l.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Palabras clave                                                     */
/* ------------------------------------------------------------------ */

export const KEYWORDS_SCHEMA = {
  type: "object",
  properties: {
    keywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          kw_type: { type: "string", enum: ["principal", "secundaria", "longtail"] },
          intent: { type: "string", enum: ["informacional", "comercial", "transaccional", "navegacional", "local"] },
          priority: { type: "integer" },
          why: { type: "string" }
        },
        required: ["keyword", "kw_type", "intent", "priority", "why"]
      }
    }
  },
  required: ["keywords"]
};

export function keywordSuggestPrompt(s: SiteCtx, existing: string[], serpSeed: string) {
  const system =
    "Eres un consultor SEO senior especializado en estrategia de contenidos y SEO local en España. Trabajas para la agencia Negocio Vivo. Propones palabras clave con intención de búsqueda real y potencial de negocio, nunca términos inventados o sin demanda plausible.";
  const user =
    `${clientContext(s)}\n\nPALABRAS CLAVE YA DEFINIDAS:\n${existing.length ? "- " + existing.join("\n- ") : "(ninguna)"}\n\n` +
    (serpSeed ? `DATOS SERP REALES (búsquedas relacionadas y preguntas de Google):\n${serpSeed}\n\n` : "") +
    "Propón 15 palabras clave nuevas (no repitas las existentes) mezclando: términos transaccionales/locales de alto valor, long-tail informacionales que atraigan tráfico cualificado y preguntas frecuentes del público. Evita duplicados semánticos. priority: 1 alta, 2 media, 3 baja.";
  return { system, user };
}

/* ------------------------------------------------------------------ */
/*  Propuestas                                                         */
/* ------------------------------------------------------------------ */

export const IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          keyword_id: { type: "string" },
          keyword: { type: "string" },
          secondary_keywords: { type: "array", items: { type: "string" } },
          intent: { type: "string" },
          funnel: { type: "string", enum: ["TOFU", "MOFU", "BOFU"] },
          format: { type: "string" },
          angle: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["title", "keyword_id", "keyword", "secondary_keywords", "intent", "funnel", "format", "angle", "rationale"]
      }
    }
  },
  required: ["ideas"]
};

export function ideasPrompt(s: SiteCtx, kwBlock: string, siteTitles: string, planned: string, n: number, focus: string) {
  const today = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date());
  const system =
    "Eres el director de contenidos SEO de la agencia Negocio Vivo. Diseñas calendarios editoriales que posicionan en Google y convierten. Piensas en clusters temáticos (pilar + satélites), intención de búsqueda, etapa del funnel, E-E-A-T y ganancia de información frente a lo que ya rankea. Nunca propones dos artículos que compitan por la misma intención (canibalización).";
  const user =
    `${clientContext(s)}\n\nFecha de hoy: ${today} (ten en cuenta estacionalidad y eventos próximos).\n\n` +
    `PALABRAS CLAVE DEL CLIENTE CON DATOS SERP:\n${kwBlock}\n\n` +
    `ARTÍCULOS YA PUBLICADOS EN LA WEB (no repetir intención, pueden ser destino de enlaces):\n${siteTitles || "(sin datos)"}\n\n` +
    `PROPUESTAS YA PLANIFICADAS O PENDIENTES (no repetir):\n${planned || "(ninguna)"}\n\n` +
    (focus ? `INDICACIONES DEL EQUIPO PARA ESTA TANDA: ${focus}\n\n` : "") +
    `Propón ${n} artículos de blog. Reglas:\n` +
    "- Cada propuesta se asigna a UNA palabra clave objetivo (keyword_id exacto del listado) y su título debe contenerla de forma natural, preferiblemente al principio.\n" +
    "- Títulos específicos y con gancho (números concretos, año si procede, beneficio claro, localidad si la intención es local). Nada de títulos genéricos tipo 'Todo lo que necesitas saber'.\n" +
    "- Mezcla formatos: guía completa, comparativa, lista, cómo hacer, precios/costes, errores comunes, casos prácticos, preguntas frecuentes, mitos.\n" +
    "- Aprovecha las preguntas 'People Also Ask' y búsquedas relacionadas para long-tails.\n" +
    "- 'angle' explica qué aportará el artículo que NO tengan los resultados actuales del top 10 (ganancia de información).\n" +
    "- 'rationale': por qué este post ahora y qué objetivo de negocio cumple.";
  return { system, user };
}

/* ------------------------------------------------------------------ */
/*  Brief SEO                                                          */
/* ------------------------------------------------------------------ */

export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    h1: { type: "string" },
    meta_title: { type: "string" },
    meta_description: { type: "string" },
    slug: { type: "string" },
    search_intent: { type: "string" },
    reader: { type: "string" },
    secondary_keywords: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "string" } },
    outline: {
      type: "array",
      items: {
        type: "object",
        properties: { h2: { type: "string" }, notes: { type: "string" }, h3: { type: "array", items: { type: "string" } } },
        required: ["h2", "notes", "h3"]
      }
    },
    faq: { type: "array", items: { type: "string" } },
    internal_links: {
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" }, anchor: { type: "string" }, section: { type: "string" } },
        required: ["url", "anchor", "section"]
      }
    },
    external_links: {
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" }, anchor: { type: "string" }, reason: { type: "string" } },
        required: ["url", "anchor", "reason"]
      }
    },
    images: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["featured", "inline"] },
          after_h2: { type: "integer" },
          subject: { type: "string" },
          alt: { type: "string" },
          title: { type: "string" },
          caption: { type: "string" }
        },
        required: ["role", "after_h2", "subject", "alt", "title", "caption"]
      }
    },
    category: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    information_gain: { type: "array", items: { type: "string" } },
    experience_points: { type: "array", items: { type: "string" } },
    word_target: { type: "integer" }
  },
  required: [
    "h1", "meta_title", "meta_description", "slug", "search_intent", "reader", "secondary_keywords", "entities",
    "outline", "faq", "internal_links", "external_links", "images", "category", "tags", "information_gain",
    "experience_points", "word_target"
  ]
};

type PostLike = {
  title: string;
  keyword: string;
  secondaryKeywords: unknown;
  intent: string;
  funnel: string;
  angle: string | null;
  notes: string | null;
  metaTitle?: string;
  metaDescription?: string;
};

export function briefPrompt(s: SiteCtx, p: PostLike, research: any) {
  const serp = research?.serp ?? {};
  const top = asArray<any>(serp.organic).map((o) => `#${o.position} ${o.title} — ${o.link}\n   ${o.snippet}`).join("\n");
  const outl = asArray<any>(research?.competitors)
    .map((c) => `- ${c.url} (~${c.words} palabras)\n  ${asArray<string>(c.headings).slice(0, 25).join("\n  ")}`)
    .join("\n");
  const internal = asArray<any>(research?.internalCandidates).slice(0, 60).map((x) => `- ${x.title} → ${x.url}`).join("\n");
  const external = asArray<any>(research?.externalCandidates).map((x) => `- ${x.title} → ${x.link}`).join("\n");

  const system =
    "Eres un estratega SEO on-page de nivel experto. Construyes briefs que permiten a un redactor crear el mejor resultado de Google para una búsqueda: cubren la intención completa, superan en profundidad y utilidad al top 10, incluyen entidades semánticas relevantes y están diseñados para featured snippets, People Also Ask y AI Overviews.";
  const user =
    `${clientContext(s)}\n\nARTÍCULO A PREPARAR\nTítulo de trabajo: ${p.title}\nPalabra clave principal: ${p.keyword}\n` +
    `Secundarias sugeridas: ${asArray<string>(p.secondaryKeywords).join(", ")}\n` +
    `Intención: ${p.intent} · Funnel: ${p.funnel}\nÁngulo: ${p.angle ?? ""}\n` +
    (p.notes ? `Instrucciones del equipo: ${p.notes}\n` : "") +
    `Extensión objetivo: entre ${s.wordsMin} y ${s.wordsMax} palabras.\n\n` +
    `TOP 10 GOOGLE:\n${top || "(sin datos SERP)"}\n` +
    `PREGUNTAS 'PEOPLE ALSO ASK': ${asArray<string>(serp.paa).join(" | ")}\n` +
    `BÚSQUEDAS RELACIONADAS: ${asArray<string>(serp.related).join(" | ")}\n\n` +
    `ESTRUCTURA DE LOS COMPETIDORES MEJOR POSICIONADOS:\n${outl || "(sin datos)"}\n\n` +
    `PÁGINAS DE LA WEB DEL CLIENTE (candidatas a enlace interno):\n${internal || "(ninguna)"}\n\n` +
    `FUENTES EXTERNAS CANDIDATAS (solo puedes usar estas URLs exactas; si ninguna es fiable, deja la lista vacía):\n${external || "(ninguna)"}\n\n` +
    "Genera el brief. Reglas:\n" +
    "- meta_title: máx. 60 caracteres, keyword principal al inicio, con gancho de CTR. Puede diferir del H1.\n" +
    "- meta_description: 140–155 caracteres, incluye la keyword, beneficio concreto y llamada a la acción implícita.\n" +
    "- slug: corto (3–6 palabras), en minúsculas, sin stopwords, con la keyword.\n" +
    "- outline: 5–9 H2 que cubran la intención completa y los gaps detectados; H3 donde aporten. El primer H2 debe responder directamente la búsqueda (bloque 'snippet' de 40–60 palabras).\n" +
    "- entities: 10–20 entidades/términos semánticos (NLP) que un experto usaría.\n" +
    "- faq: 4–6 preguntas reales (prioriza People Also Ask) para bloque FAQ con schema.\n" +
    "- internal_links: 3–6 enlaces a URLs EXACTAS de la lista del cliente, con anchor descriptivo y variado (nunca 'haz clic aquí'). Incluye la página de servicio/contacto más relevante.\n" +
    "- external_links: 1–3 URLs EXACTAS de la lista de fuentes candidatas, solo autoridades (organismos oficiales, estudios, asociaciones); nunca competidores.\n" +
    `- images: exactamente ${s.imagesPerPost} imágenes. La primera es 'featured'. Para cada una describe en INGLÉS la escena concreta (subject), en ${langName(s.language)} el alt SEO (describe la imagen e incluye la keyword o una secundaria de forma natural, máx. 125 caracteres), title y caption. 'after_h2' = índice (0-based) del H2 tras cuyo primer párrafo va la imagen (la featured no se inserta en el cuerpo). Las escenas deben ser realistas, sin texto ni rótulos, coherentes con el sector.\n` +
    "- information_gain: 3–5 aportes concretos que harán este artículo mejor que el top 10.\n" +
    "- experience_points: 2–4 lugares donde encaja experiencia real del negocio (ejemplos, procesos, observaciones) sin inventar datos.";
  return { system, user };
}

/* ------------------------------------------------------------------ */
/*  Reglas de escritura humana                                         */
/* ------------------------------------------------------------------ */

export function humanRules(lang: string): string {
  const es = lang.startsWith("es");
  const cliches = es
    ? "en el mundo actual, en la era digital, hoy en día más que nunca, sin lugar a dudas, cabe destacar, es importante destacar/señalar/tener en cuenta, en conclusión, en resumen, en definitiva, adentrarnos, sumergirnos, desbloquear, potenciar al máximo, llevar al siguiente nivel, un viaje, el panorama, navegar por, en el vertiginoso, un sinfín de, una amplia gama de, juega un papel crucial/fundamental, no solo… sino también (máx. 1 vez), vamos a explorar, a lo largo de este artículo, ¿alguna vez te has preguntado…?, imagina que…, descubre cómo, ¡sigue leyendo!, esperamos que este artículo te haya sido útil, clave (como muletilla), robusto, integral, holístico, sinergia"
    : "in today's world, digital age, delve, dive into, unlock, unleash, elevate, navigate the landscape, tapestry, crucial role, game-changer, it's important to note, in conclusion, in summary, furthermore/moreover (overuse), seamless, robust, holistic, embark on a journey";
  return (
    "REGLAS DE ESCRITURA HUMANA (no negociables):\n" +
    "1. Escribe como un profesional del sector con años de experiencia que explica algo a un cliente, no como una IA. Opiniones claras cuando proceda, matices reales, criterio.\n" +
    "2. Ritmo variable: alterna frases cortas y contundentes con otras largas y bien articuladas. Párrafos de 1 a 4 frases. Nunca tres párrafos seguidos con la misma estructura.\n" +
    "3. Concreción: ejemplos específicos del sector y de la zona del cliente, cifras orientativas solo si son de conocimiento general y prudentes, pasos accionables, errores reales que comete la gente.\n" +
    "4. PROHIBIDO inventar estadísticas, estudios, citas textuales, testimonios, nombres de pacientes/clientes, premios o datos de la empresa que no estén en el contexto. Si algo requiere dato, formúlalo sin cifra falsa.\n" +
    `5. Evita estas muletillas típicas de IA: ${cliches}.\n` +
    "6. Evita: abrir cada sección con una pregunta retórica, cerrar cada sección con una frase-resumen, enumerar siempre de tres en tres, el abuso de rayas (—) y de dos puntos, negritas en exceso (máx. 1 por sección y solo en ideas clave), emojis.\n" +
    "7. Listas solo cuando el contenido sea realmente enumerable (pasos, requisitos, comparativas). El resto, prosa.\n" +
    "8. La introducción (sin encabezado) va al grano en 2–4 frases: plantea el problema del lector y lo que va a obtener. Sin 'En este artículo veremos'.\n" +
    "9. El cierre no se llama 'Conclusión': usa un H2 con valor propio (p. ej. siguiente paso, recomendación final) e integra la llamada a la acción del cliente de forma natural.\n" +
    `10. Idioma: ${langName(lang)}. Ortografía y tipografía impecables (tildes, signos de apertura ¿¡ en español).\n`
  );
}

/* ------------------------------------------------------------------ */
/*  Redacción                                                          */
/* ------------------------------------------------------------------ */

export function draftPrompt(s: SiteCtx, p: PostLike, brief: any) {
  let imgLines = "";
  asArray<any>(brief?.images).forEach((img, i) => {
    if (i === 0) return;
    imgLines += `- Marcador <!--NVP_IMG_${i}--> tras el primer párrafo del H2 nº ${Number(img.after_h2 ?? i)} (0-based).\n`;
  });
  const system =
    "Eres un redactor SEO senior y experto en el sector del cliente. Tu trabajo se publica tal cual, así que debe ser impecable, útil, preciso y con voz humana indistinguible de un profesional.\n\n" +
    humanRules(s.language);
  const user =
    `${clientContext(s)}\n\nBRIEF SEO (síguelo con rigor):\n${JSON.stringify(brief)}\n\n` +
    (p.notes ? `INSTRUCCIONES DEL EQUIPO: ${p.notes}\n\n` : "") +
    "REQUISITOS SEO:\n" +
    `- Palabra clave principal «${p.keyword}»: en las primeras 100 palabras, en al menos un H2, y repartida de forma natural (densidad 0,5–1,5 %). Usa variaciones y sinónimos; nunca la fuerces.\n` +
    "- Usa las secundarias y las entidades del brief donde encajen de forma natural.\n" +
    "- Justo después de la introducción, el primer H2 responde la búsqueda en un párrafo de 40–60 palabras (optimizado para fragmento destacado).\n" +
    '- Inserta TODOS los enlaces internos y externos del brief con <a href="URL exacta">anchor</a> dentro del texto, en contexto. Los externos llevan target="_blank" rel="noopener". No inventes ninguna otra URL.\n' +
    "- Incluye al menos una tabla HTML (<table> con <thead>) si hay datos comparables, o una lista de pasos numerada si es un proceso.\n" +
    "- Sección final de preguntas: <h2>Preguntas frecuentes</h2> y cada pregunta del brief como <h3>¿…?</h3> seguida de una respuesta de 40–80 palabras en <p>.\n" +
    `- Extensión: entre ${s.wordsMin} y ${s.wordsMax} palabras.\n` +
    (imgLines ? `- Imágenes: coloca estos marcadores exactos en líneas propias:\n${imgLines}` : "") +
    "\nFORMATO DE SALIDA: solo el HTML del cuerpo (sin <html>, <body>, sin H1, sin índice/tabla de contenidos, sin comentarios aparte de los marcadores de imagen, sin estilos inline, sin ``` ). Etiquetas permitidas: h2, h3, p, ul, ol, li, strong, em, a, table, thead, tbody, tr, th, td, blockquote.";
  return { system, user };
}

export function humanizePrompt(s: SiteCtx, p: PostLike, html: string) {
  const system =
    "Eres el editor jefe de una publicación especializada. Recibes un borrador y lo conviertes en un texto que un lector experto atribuiría sin dudar a un profesional humano con experiencia. Conservas la estructura SEO (encabezados, enlaces, marcadores de imagen, FAQ, keyword) y mejoras todo lo demás.\n\n" +
    humanRules(s.language);
  const user =
    `${clientContext(s)}\n\nPalabra clave principal: «${p.keyword}»\n\nBORRADOR:\n${html}\n\n` +
    "TAREA DE EDICIÓN:\n" +
    "1. Detecta y reescribe cualquier frase con aroma a IA (muletillas, simetrías, generalidades vacías, conectores repetidos, estructuras paralelas mecánicas).\n" +
    "2. Varía la longitud de frases y párrafos; elimina relleno; cada párrafo debe aportar algo.\n" +
    "3. Añade matiz experto: advertencias reales, excepciones, 'depende de…' explicado, criterio profesional. Sin inventar datos.\n" +
    "4. Revisa que la introducción vaya al grano y que el cierre integre la llamada a la acción con naturalidad.\n" +
    "5. Mantén EXACTAMENTE: todos los <a href> (mismas URLs), los marcadores <!--NVP_IMG_n-->, los H2/H3 (puedes pulir su redacción manteniendo la keyword donde esté) y el bloque «Preguntas frecuentes».\n" +
    "6. Corrige ortografía, gramática y tipografía.\n\n" +
    "Devuelve SOLO el HTML final del cuerpo, sin explicaciones ni ``` .";
  return { system, user };
}

export function seoFixPrompt(s: SiteCtx, p: PostLike, html: string, issues: string[]) {
  const system =
    "Eres un especialista SEO on-page. Corriges un artículo para resolver problemas concretos detectados por una auditoría, sin estropear la naturalidad del texto ni su voz humana.\n\n" +
    humanRules(s.language);
  const user =
    `Palabra clave principal: «${p.keyword}»\nMeta title actual: ${p.metaTitle ?? ""}\nMeta description actual: ${p.metaDescription ?? ""}\n\n` +
    `PROBLEMAS A CORREGIR:\n- ${issues.join("\n- ")}\n\nARTÍCULO:\n${html}\n\n` +
    "Corrige SOLO lo necesario. Conserva enlaces, marcadores <!--NVP_IMG_n--> y bloque FAQ.\n\n" +
    "FORMATO DE SALIDA EXACTO (sin ``` ni explicaciones):\n" +
    "<!--META_TITLE: meta title corregido, máx. 60 caracteres-->\n" +
    "<!--META_DESCRIPTION: meta description corregida, 140–155 caracteres-->\n" +
    "…a continuación el cuerpo HTML completo corregido…";
  return { system, user };
}

/* ------------------------------------------------------------------ */
/*  Imágenes                                                           */
/* ------------------------------------------------------------------ */

export function imagePrompt(s: SiteCtx, img: any, hasRefs: boolean): string {
  const style = [s.visualStyle, s.visualNotes].filter(Boolean).join(" ").trim();
  const parts: string[] = [];
  if (hasRefs) {
    parts.push(
      "Use the reference images as the visual style guide only: match their color palette, lighting, mood, composition and photographic treatment. Create a completely new scene."
    );
  }
  parts.push(`Scene: ${String(img?.subject ?? "").trim()}.`);
  if (style) parts.push(`Visual style: ${style}.`);
  parts.push(
    `Photorealistic editorial blog image, natural and authentic, high detail, professional lighting, clean text-free surfaces, suitable as a website article image for a ${s.sector || "local business"}.`
  );
  return parts.join(" ");
}

export const STYLE_SCHEMA = {
  type: "object",
  properties: {
    style_prompt: { type: "string" },
    palette: { type: "array", items: { type: "string" } },
    mood: { type: "string" },
    summary_es: { type: "string" }
  },
  required: ["style_prompt", "palette", "mood", "summary_es"]
};

export const STYLE_SYSTEM =
  "Eres director de arte. Analizas imágenes de referencia de una marca y extraes una guía de estilo visual reutilizable para generar nuevas imágenes con IA (Seedream).";
export const STYLE_USER =
  "Analiza estas imágenes de referencia del cliente y describe su estilo común.\n" +
  "- style_prompt: 60-110 palabras en INGLÉS, solo descripciones positivas (paleta con hex aproximados, luz, sensación de lente/cámara, composición, texturas, ambiente, sujetos/escenarios típicos). Sin negaciones.\n" +
  "- palette: colores hex dominantes.\n- mood: ambiente en español.\n- summary_es: resumen en español de 2 frases para el equipo.";
