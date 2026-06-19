/**
 * Contenido editorial SEO de las páginas del directorio Bubui.
 *
 * Estrategia: SIEMPRE hay una plantilla extensa y única (tejida con datos
 * reales: sector, localidad, provincia, nº y nombres de negocios), optimizada
 * para las consultas long-tail. Encima, si existe contenido IA cacheado en
 * BubuiDirectoryContent (generado por el endpoint admin), se usa como
 * introducción principal. Así las páginas nunca quedan "finas" y no llamamos
 * a la IA en cada visita.
 */
import { prisma } from "@/lib/db/prisma";
import { slugify } from "@/lib/bubui/directory";

export type EditorialContent = {
  intro: string[]; // párrafos
  sections: { h: string; p: string }[];
  faq: { q: string; a: string }[];
};

// ── Claves de caché ────────────────────────────────────────────────────────
export const keyListing = (catSlug: string, citySlug: string) => `cl:${catSlug}:${citySlug}`;
export const keyCategory = (catSlug: string) => `c:${catSlug}`;
export const keyLocality = (citySlug: string) => `l:${citySlug}`;

/** Intro IA cacheada (párrafos) o null si no se ha generado. */
export async function getStoredIntro(key: string): Promise<string[] | null> {
  const row = await prisma.bubuiDirectoryContent.findUnique({ where: { key } });
  if (!row?.intro?.trim()) return null;
  return row.intro.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

// Selección determinista para variar la redacción entre páginas (anti-footprint).
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pick<T>(seed: string, arr: T[]): T {
  return arr[hash(seed) % arr.length];
}

function listNames(names: string[], max = 6): string {
  const n = names.slice(0, max);
  if (n.length === 0) return "";
  if (n.length === 1) return n[0];
  return `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

// ── Plantilla: nicho + localidad (la página que convierte) ──────────────────
export function templateListing(input: {
  catLabel: string;
  catSingular: string;
  cityLabel: string;
  province: string | null;
  count: number;
  names: string[];
}): EditorialContent {
  const { catLabel, catSingular, cityLabel, province, count, names } = input;
  const seed = `${catLabel}|${cityLabel}`;
  const lc = catLabel.toLowerCase();
  const prov = province ? `, en plena provincia de ${province},` : "";
  const nCount = count === 1 ? `${count} ${catSingular}` : `${count} ${lc}`;

  const intro = [
    `¿Buscas ${lc} en ${cityLabel}? En Bubui hemos reunido ${pick(seed, ["las mejores", "una selección de", "los mejores"])} ${lc} de ${cityLabel}${prov} para que encuentres justo lo que necesitas cerca de ti y, además, ahorres en cada visita. Ahora mismo hay ${nCount} ${count === 1 ? "disponible" : "disponibles"} en esta página, con sus ofertas y descuentos actualizados.`,
    `${cityLabel} cuenta con una amplia oferta de ${lc}, y elegir la adecuada no siempre es fácil. Por eso en Bubui te mostramos cada ${catSingular} de ${cityLabel} con su información esencial —ubicación, descripción y descuento disponible— y la posibilidad de llevarte ventajas exclusivas solo por formar parte de la comunidad. Compara, descubre y elige tu ${catSingular} de confianza en ${cityLabel} en pocos minutos.`,
    `Lo mejor de buscar tu ${catSingular} en ${cityLabel} a través de Bubui es que no solo accedes a un directorio actualizado de negocios locales: cada compra te abre descuentos cruzados en otros comercios de ${cityLabel}, de modo que apoyar al comercio local de tu zona también te sale a cuenta.`
  ];
  if (names.length > 0) {
    intro.push(
      `Entre las ${lc} que ya forman parte de Bubui en ${cityLabel} encontrarás ${listNames(names)}${names.length > 6 ? ", entre muchas otras" : ""}. Pincha en cualquiera para ver su ficha completa, sus ofertas y cómo conseguir tu descuento.`
    );
  }

  const sections: { h: string; p: string }[] = [
    {
      h: `¿Por qué elegir tu ${catSingular} en ${cityLabel} con Bubui?`,
      p: `Bubui es el directorio de comercios locales de ${cityLabel} pensado tanto para vecinos como para visitantes. A diferencia de un buscador genérico, aquí cada ${catSingular} de ${cityLabel} ofrece descuentos reales y ventajas para sus clientes. Encontrarás ${lc} cercanas, con reseñas, ofertas y la tranquilidad de apoyar a negocios de ${cityLabel}${province ? ` (${province})` : ""}.`
    },
    {
      h: `Descuentos y ofertas en ${catLabel.toLowerCase()} de ${cityLabel}`,
      p: `Todos los negocios de Bubui en ${cityLabel} aplican descuentos a sus clientes. El funcionamiento es sencillo: eliges tu ${catSingular}, disfrutas del servicio y obtienes tu descuento; además, cada visita desbloquea ofertas en otros comercios de ${cityLabel}. Así, cuanto más compras en tu zona, más ahorras. Es la forma más cómoda de descubrir ${lc} en ${cityLabel} y sacarles partido.`
    }
  ];
  if (names.length > 0) {
    sections.push({
      h: `${catLabel} destacadas en ${cityLabel}`,
      p: `Algunas de las ${lc} más activas en Bubui dentro de ${cityLabel} son ${listNames(names, 8)}. Cada una mantiene su ficha al día con horarios, ubicación y promociones, para que decidas con toda la información antes de visitarla.`
    });
  }

  const faq = [
    {
      q: `¿Cuántas ${catLabel.toLowerCase()} hay en ${cityLabel} en Bubui?`,
      a: `Actualmente hay ${nCount} ${count === 1 ? "registrada" : "registradas"} en Bubui en ${cityLabel}, y el listado crece cada semana a medida que se dan de alta nuevos negocios de ${cityLabel}.`
    },
    {
      q: `¿Cómo consigo descuentos en ${lc} de ${cityLabel}?`,
      a: `Solo tienes que entrar en Bubui, elegir tu ${catSingular} en ${cityLabel} y seguir las indicaciones de su ficha. Al comprar obtienes tu descuento y desbloqueas ofertas en otros comercios locales de ${cityLabel}.`
    },
    {
      q: `¿Cuál es la mejor ${catSingular} de ${cityLabel}?`,
      a: `La mejor ${catSingular} de ${cityLabel} depende de lo que busques. En Bubui puedes comparar las ${lc} de ${cityLabel} por ubicación, descripción y ofertas para encontrar la que mejor encaja contigo.`
    },
    {
      q: `Tengo ${catSingular === "negocio" ? "un negocio" : `${/a$/.test(catSingular) ? "una" : "un"} ${catSingular}`} en ${cityLabel}, ¿cómo aparezco aquí?`,
      a: `Date de alta gratis en Bubui en un par de minutos. Tu ${catSingular} aparecerá automáticamente en esta página de ${lc} en ${cityLabel} y empezarás a ganar visibilidad y nuevos clientes en tu zona.`
    }
  ];

  return { intro, sections, faq };
}

// ── Plantilla: sector (todas las localidades) ───────────────────────────────
export function templateCategory(input: { catLabel: string; catSingular: string; cityCount: number }): EditorialContent {
  const { catLabel, catSingular } = input;
  const lc = catLabel.toLowerCase();
  return {
    intro: [
      `Encuentra ${lc} cerca de ti con Bubui, el directorio de comercios locales con descuentos. Selecciona tu localidad para ver las ${lc} disponibles, sus ofertas y cómo conseguir ventajas exclusivas en cada visita.`,
      `Tanto si buscas ${lc} de confianza en tu barrio como si quieres descubrir nuevas opciones, en Bubui reunimos los mejores negocios del sector por localidad, con información actualizada y descuentos reales para sus clientes.`
    ],
    sections: [
      {
        h: `${catLabel} con descuentos cerca de ti`,
        p: `Cada ${catSingular} de Bubui ofrece descuentos a sus clientes y forma parte de una red de comercios locales. Elige tu localidad para ver las ${lc} disponibles y empezar a ahorrar mientras apoyas al comercio de tu zona.`
      }
    ],
    faq: [
      { q: `¿Cómo encuentro ${lc} cerca de mí?`, a: `Selecciona tu localidad en esta página y verás todas las ${lc} de Bubui en esa zona, con sus ofertas y ubicación.` },
      { q: `¿Las ${lc} de Bubui tienen descuentos?`, a: `Sí. Todos los negocios de Bubui, incluidas las ${lc}, aplican descuentos a sus clientes y desbloquean ofertas en otros comercios locales.` }
    ]
  };
}

// ── Plantilla: localidad (todos los sectores) ───────────────────────────────
export function templateLocality(input: { cityLabel: string; province: string | null; total: number; catLabels: string[] }): EditorialContent {
  const { cityLabel, province, total, catLabels } = input;
  const prov = province ? ` (${province})` : "";
  return {
    intro: [
      `Descubre los negocios locales de ${cityLabel}${prov} en Bubui. Hemos reunido ${total} ${total === 1 ? "negocio" : "negocios"} de ${cityLabel} con descuentos y ofertas para sus clientes: ${listNames(catLabels, 5).toLowerCase()} y más. Todo en un mismo sitio para que ahorres mientras apoyas al comercio de ${cityLabel}.`,
      `Comprar en los negocios de ${cityLabel} con Bubui tiene premio: cada compra te abre descuentos cruzados en otros comercios de ${cityLabel}, fomentando el comercio local y ayudándote a ahorrar en tu día a día. Elige un sector para empezar a explorar.`
    ],
    sections: [
      {
        h: `Negocios con descuentos en ${cityLabel}`,
        p: `En ${cityLabel} encontrarás negocios de múltiples sectores dentro de Bubui, todos con descuentos para sus clientes. Selecciona la categoría que te interesa para ver las opciones disponibles en ${cityLabel} y sus ofertas actualizadas.`
      }
    ],
    faq: [
      { q: `¿Qué negocios de ${cityLabel} están en Bubui?`, a: `En ${cityLabel} hay ${total} ${total === 1 ? "negocio" : "negocios"} en Bubui de sectores como ${listNames(catLabels, 5).toLowerCase()}. El listado crece cada semana.` },
      { q: `¿Tengo un negocio en ${cityLabel}, cómo aparezco?`, a: `Date de alta gratis en Bubui y tu negocio aparecerá en el directorio de ${cityLabel}, ganando visibilidad y nuevos clientes en tu zona.` }
    ]
  };
}

/** JSON-LD FAQPage a partir de las preguntas/respuestas (rich results). */
export function faqJsonLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

export { slugify };
