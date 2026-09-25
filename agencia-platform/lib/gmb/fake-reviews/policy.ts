/**
 * Revisión de contenido de reseñas frente a la política de contenido de Google Maps
 * (contenido prohibido y restringido). Dos capas:
 *  1) Reglas deterministas (léxico soez/insultos, emojis despectivos, datos personales, enlaces…).
 *  2) Clasificación con IA (Claude) que cita el fragmento exacto y explica la infracción.
 * El resultado alimenta el informe para Google y el escrito a soporte.
 */

export type PolicyCategory =
  | "acoso_insultos"
  | "lenguaje_obsceno"
  | "odio_discriminacion"
  | "informacion_personal"
  | "conflicto_interes"
  | "fuera_de_tema"
  | "contenido_falso"
  | "sexual"
  | "peligroso_ilegal"
  | "suplantacion"
  | "spam_enlaces";

export const POLICY_CATEGORIES: Record<PolicyCategory, { label: string; google: string; desc: string }> = {
  acoso_insultos: { label: "Acoso o insultos", google: "Acoso (Harassment)", desc: "Ataques personales, insultos o amenazas dirigidos al negocio, a su personal o a terceros." },
  lenguaje_obsceno: { label: "Lenguaje obsceno o soez", google: "Contenido ofensivo / obscenidad y lenguaje soez (Offensive content)", desc: "Palabrotas, lenguaje vulgar o emojis obscenos o despectivos." },
  odio_discriminacion: { label: "Incitación al odio o discriminación", google: "Incitación al odio (Hate speech)", desc: "Contenido que ataca a personas por origen, religión, orientación, género, discapacidad u otras características." },
  informacion_personal: { label: "Información personal", google: "Información personal (Personal information)", desc: "Nombres completos de empleados con datos privados, teléfonos, emails, direcciones u otros datos personales." },
  conflicto_interes: { label: "Conflicto de intereses", google: "Conflicto de intereses (Conflict of interest)", desc: "Reseñas de competidores, ex-empleados o personas con interés en perjudicar al negocio." },
  fuera_de_tema: { label: "Fuera de tema", google: "Contenido no relacionado (Off-topic)", desc: "No describe una experiencia real con el negocio: opiniones políticas, quejas genéricas, otro negocio, etc." },
  contenido_falso: { label: "Contenido falso o interacción falsa", google: "Contenido falso / interacción falsa (Fake engagement)", desc: "Reseña que no refleja una experiencia real o forma parte de una campaña coordinada." },
  sexual: { label: "Contenido sexual", google: "Contenido sexual explícito (Sexually explicit content)", desc: "Contenido sexual explícito o insinuaciones sexuales." },
  peligroso_ilegal: { label: "Contenido peligroso o ilegal", google: "Contenido peligroso / ilegal (Dangerous / Illegal content)", desc: "Amenazas, incitación a la violencia o a actividades ilegales." },
  suplantacion: { label: "Suplantación de identidad", google: "Suplantación (Impersonation)", desc: "Se hace pasar por otra persona u organización." },
  spam_enlaces: { label: "Spam o publicidad", google: "Spam y contenido falso (Spam)", desc: "Enlaces, promociones, teléfonos o texto repetitivo sin relación con la experiencia." }
};

export type PolicyViolation = { category: PolicyCategory; evidence: string; explanation: string; source: "reglas" | "ia"; weak?: boolean };

export type PolicyFinding = {
  reviewId: string;
  author: string;
  authorLink: string;
  rating: number;
  date: string;
  text: string;
  link: string;
  likelihood: "alta" | "media" | "baja";
  summary: string;
  violations: PolicyViolation[];
};

export type PolicyResults = { checked: number; aiUsed: boolean; findings: PolicyFinding[] };

/* ───────────────────────── Reglas deterministas ───────────────────────── */

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Palabras soeces e insultos frecuentes (ES/EN). Se buscan como palabra completa.
const PROFANITY = [
  "mierda", "puta", "puto", "putos", "putas", "joder", "jodido", "jodidos", "cono", "coño", "carajo", "hostia", "hostias", "polla", "cojones", "follar",
  "hijo de puta", "hijos de puta", "hdp", "me cago", "cagada", "fuck", "fucking", "shit", "bullshit", "motherfucker", "wtf"
];
const INSULTS = [
  "gilipollas", "cabron", "cabrones", "imbecil", "imbeciles", "idiota", "idiotas", "subnormal", "subnormales", "capullo", "capullos",
  "sinverguenza", "sinverguenzas", "escoria", "mamarracho", "mamarrachos", "zorra", "guarra", "retrasado", "retrasada", "mongolo", "bastardo", "bastardos",
  "malnacido", "desgraciado", "desgraciados", "gentuza", "chusma", "pendejo", "pendejos", "idiot", "idiots", "moron", "morons", "asshole", "assholes",
  "bitch", "scum", "retard"
];
// Términos que pueden ser insulto o solo una valoración dura: se marcan como indicio débil.
const WEAK_INSULTS = ["tonto", "tontos", "inutil", "inutiles", "payaso", "payasos", "cerdo", "cerdos", "rata", "ratas", "basura", "estupido", "estupidos", "stupid", "loser", "losers", "dumb", "ladrones", "estafadores"];
const HATE = ["sudaca", "sudacas", "moro de mierda", "moros de mierda", "maricon", "maricones", "panchito", "panchitos", "negrata", "gitano de mierda", "gitanos de mierda", "faggot", "nigger"];
const THREATS = ["os voy a matar", "te voy a matar", "vais a pagar", "os vais a enterar", "te vas a enterar", "quemar el local", "os denuncio y os hundo", "i will kill"];
const CONFLICT = ["trabaje aqui", "trabaje alli", "ex empleado", "exempleado", "ex trabajador", "extrabajador", "fui empleado", "fui empleada", "soy de la competencia", "mi negocio es mejor", "mi local", "nuestro local es", "vengan a mi", "worked here", "former employee"];
const OFFENSIVE_EMOJI = ["🖕", "💩", "🤮", "🤢", "🤬", "🤡", "🐀", "🐷", "🐖", "🐽", "🗑", "🚮", "👎🏿"];

function wordHit(text: string, term: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9ñ])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9ñ])`, "i");
  return re.test(text);
}

function snippet(original: string, needle: string): string {
  const i = strip(original).indexOf(strip(needle));
  if (i < 0) return needle;
  const start = Math.max(0, i - 40);
  const end = Math.min(original.length, i + needle.length + 40);
  return `${start > 0 ? "…" : ""}${original.slice(start, end)}${end < original.length ? "…" : ""}`;
}

export function ruleViolations(text: string): PolicyViolation[] {
  const t = strip(text ?? "");
  if (!t.trim()) return [];
  const out: PolicyViolation[] = [];
  const add = (category: PolicyCategory, evidence: string, explanation: string, weak = false) => {
    if (!out.some((v) => v.category === category)) out.push({ category, evidence, explanation, source: "reglas", ...(weak ? { weak } : {}) });
  };

  const prof = PROFANITY.filter((w) => wordHit(t, strip(w)));
  if (prof.length) add("lenguaje_obsceno", snippet(text, prof[0]), `Contiene lenguaje soez: «${prof.slice(0, 3).join("», «")}».`);
  const ins = INSULTS.filter((w) => wordHit(t, strip(w)));
  if (ins.length) add("acoso_insultos", snippet(text, ins[0]), `Contiene insultos: «${ins.slice(0, 3).join("», «")}».`);
  const weak = WEAK_INSULTS.filter((w) => wordHit(t, strip(w)));
  if (weak.length) add("acoso_insultos", snippet(text, weak[0]), `Posible descalificación o insulto: «${weak.slice(0, 3).join("», «")}».`, true);
  const hate = HATE.filter((w) => wordHit(t, strip(w)));
  if (hate.length) add("odio_discriminacion", snippet(text, hate[0]), `Contiene expresiones discriminatorias: «${hate[0]}».`);
  const thr = THREATS.filter((w) => t.includes(strip(w)));
  if (thr.length) add("peligroso_ilegal", snippet(text, thr[0]), "Contiene una amenaza.");
  const coi = CONFLICT.filter((w) => t.includes(strip(w)));
  if (coi.length) add("conflicto_interes", snippet(text, coi[0]), "El autor indica una relación (ex-empleado, competidor…) que supone conflicto de intereses.");
  const emo = OFFENSIVE_EMOJI.filter((e) => (text ?? "").includes(e));
  if (emo.length) add("lenguaje_obsceno", emo.join(" "), `Incluye emojis ofensivos o despectivos (${emo.join(" ")}).`);

  const phone = (text ?? "").match(/(?:\+?34[\s.-]?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/);
  if (phone) add("informacion_personal", phone[0], "Publica un número de teléfono.");
  const email = (text ?? "").match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) add("informacion_personal", email[0], "Publica una dirección de email.");
  const url = (text ?? "").match(/\b(?:https?:\/\/|www\.)\S+/i);
  if (url) add("spam_enlaces", url[0], "Incluye un enlace externo.");
  return out;
}

/* ───────────────────────── IA ───────────────────────── */

export const POLICY_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          likelihood: { type: "string", enum: ["alta", "media", "baja", "ninguna"] },
          summary: { type: "string" },
          violations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string", enum: Object.keys(POLICY_CATEGORIES) },
                evidence: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["category", "evidence", "explanation"],
              additionalProperties: false
            }
          }
        },
        required: ["id", "likelihood", "summary", "violations"],
        additionalProperties: false
      }
    }
  },
  required: ["results"],
  additionalProperties: false
};

export const POLICY_SYSTEM = `Eres un especialista en moderación de reseñas de Google Maps / Perfil de Empresa de Google. Evalúas si cada reseña incumple la política de contenido prohibido y restringido de Google Maps, para solicitar su retirada.
Categorías (usa solo estos códigos):
${Object.entries(POLICY_CATEGORIES).map(([k, v]) => `- ${k}: ${v.label} — ${v.desc}`).join("\n")}
Reglas:
- Una reseña negativa NO se puede retirar solo por ser negativa, dura o injusta. Solo marca infracciones claras y citables.
- "evidence" debe ser el fragmento EXACTO de la reseña (o el emoji) que prueba la infracción.
- "explanation": una frase en español, objetiva, que explique por qué incumple la política.
- likelihood = probabilidad de que Google la retire: "alta" (infracción evidente: insultos, soeces, datos personales, odio, amenazas, conflicto de intereses declarado), "media" (indicios razonables: fuera de tema, acusaciones sin relación con una experiencia), "baja" (dudoso), "ninguna" (sin infracción; violations vacío).
- Considera los emojis: 🖕💩🤮🤬🤡🐀🐷 u otros usados para insultar cuentan como lenguaje ofensivo.
- Si la reseña no tiene texto, likelihood "ninguna" (el contenido no se puede evaluar).
- Responde en español.`;

export function policyUserPrompt(business: string, items: { id: string; rating: number; date: string; text: string }[]): string {
  return `Negocio reseñado: ${business}\nReseñas a evaluar (JSON):\n${JSON.stringify(items)}`;
}

export function mergeFinding(
  base: Omit<PolicyFinding, "likelihood" | "summary" | "violations">,
  rules: PolicyViolation[],
  ai: { likelihood: string; summary: string; violations: { category: string; evidence: string; explanation: string }[] } | null
): PolicyFinding | null {
  const violations: PolicyViolation[] = [...rules];
  for (const v of ai?.violations ?? []) {
    if (!(v.category in POLICY_CATEGORIES)) continue;
    const existing = violations.find((x) => x.category === v.category);
    if (existing) {
      existing.source = "ia";
      delete existing.weak;
      if (!existing.explanation.includes(v.explanation)) existing.explanation = v.explanation;
    } else violations.push({ category: v.category as PolicyCategory, evidence: v.evidence, explanation: v.explanation, source: "ia" });
  }
  if (!violations.length) return null;
  const strongRule = rules.some((r) => !r.weak && ["acoso_insultos", "lenguaje_obsceno", "odio_discriminacion", "informacion_personal", "peligroso_ilegal", "conflicto_interes"].includes(r.category));
  let likelihood: PolicyFinding["likelihood"] =
    ai?.likelihood === "alta" || strongRule ? "alta" : ai?.likelihood === "media" ? "media" : ai ? "baja" : "media";
  if (ai?.likelihood === "ninguna" && !strongRule) likelihood = "baja";
  const summary = ai?.summary?.trim() || violations.map((v) => POLICY_CATEGORIES[v.category].label).join(", ");
  return { ...base, likelihood, summary, violations };
}
