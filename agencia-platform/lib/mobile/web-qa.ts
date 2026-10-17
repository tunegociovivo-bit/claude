import { z } from "zod";

export const webQaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  keyword: z.string().trim().min(1).max(200),
  business: z.string().trim().min(1).max(120),
  urls: z.array(z.string().url().max(2000)).min(1).max(20),
  seconds: z.number().int().min(30).max(900),
});
export type WebQaTemplate = z.infer<typeof webQaSchema>;

export function validateWebQa(input: unknown): WebQaTemplate {
  const config = webQaSchema.parse(input);
  let origin = "";
  config.urls = [...new Set(config.urls.map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
      throw new Error("Usa URLs HTTPS sin credenciales, parametros ni fragmentos.");
    }
    if (!origin) origin = url.origin;
    if (url.origin !== origin) throw new Error("Cada plantilla debe contener URLs de una sola web.");
    if (/(?:^|\/)(?:logout|signout|delete|remove|checkout|cart|wp-admin|wp-login|pago|comprar|carrito|eliminar|salir)(?:[/.\-_]|$)/i.test(decodeURIComponent(url.pathname))) {
      throw new Error("No incluyas paginas de acceso, compra o acciones sensibles.");
    }
    return url.href;
  }))];
  return config;
}

export function webQaSearchUrl(config: WebQaTemplate): string {
  return `https://www.google.com/search?q=${encodeURIComponent(config.keyword)}`;
}

export function webQaLaunchUrl(input: WebQaTemplate, id: string): string {
  const config = validateWebQa(input);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Identificador de prueba invalido.");
  const url = new URL(config.urls[0]);
  url.searchParams.set("nv_test", id);
  url.hash = `nv-qa=${encodeURIComponent(JSON.stringify({ v: 1, id, urls: config.urls, seconds: config.seconds }))}`;
  return url.href;
}
