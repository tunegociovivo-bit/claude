import { convert } from "html-to-text";
import { fetchText } from "@/lib/leads/email-extract";

export function normalizeTopics(topics: string[] = []): string[] {
  return [...new Map(topics.map((t) => [t.trim().toLocaleLowerCase(), t.trim()])).values()].filter(Boolean);
}

export function normalizeContent(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Coverage is checked against actual copy, not just the model's labels. */
export function coveredTopics(post: { title?: string; content?: string }, topics: string[]): string[] {
  const copy = normalizeContent(`${post.title ?? ""} ${post.content ?? ""}`);
  return topics.filter((topic) => copy.includes(normalizeContent(topic)));
}

export function repeatsUsedContent(post: { title?: string; content?: string }, used: { title: string; content: string | null }[]): boolean {
  const title = normalizeContent(post.title ?? "");
  const content = normalizeContent(post.content ?? "");
  const words = new Set(content.split(" ").filter((w) => w.length > 3));
  return used.some((old) => {
    if (title && title === normalizeContent(old.title)) return true;
    const previous = normalizeContent(old.content ?? "");
    if (content && content === previous) return true;
    const oldWords = new Set(previous.split(" ").filter((w) => w.length > 3));
    if (words.size < 12 || oldWords.size < 12) return false;
    const overlap = [...words].filter((word) => oldWords.has(word)).length;
    return overlap / Math.max(words.size, oldWords.size) >= 0.85;
  });
}

export async function loadMonthlyReferences(urls: string[]): Promise<{ url: string; text: string }[]> {
  return Promise.all([...new Set(urls)].map(async (url) => {
    try {
      const html = await fetchText(url);
      const text = convert(html, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }] }).trim().slice(0, 16000);
      if (text.length < 40) throw new Error("La página no contiene texto utilizable; sube una imagen de referencia o copia su contenido en las instrucciones.");
      return { url, text };
    } catch (error) {
      throw new Error(`No se pudo leer la referencia ${url}: ${error instanceof Error ? error.message : "error de descarga"}`);
    }
  }));
}
