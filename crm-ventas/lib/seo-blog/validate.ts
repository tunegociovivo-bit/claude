/**
 * Validación de entradas de las rutas del Publicador SEO (zod). Los errores se
 * devuelven con el formato del CRM: { error: { code: "validation_error", message } }.
 */
import { z, type ZodTypeAny } from "zod";
import { ApiError } from "@/lib/api/auth";

export { z };

export async function readJson(req: Request): Promise<unknown> {
  const body = await req.json().catch(() => ({}));
  return body && typeof body === "object" ? body : {};
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new ApiError(400, "validation_error", `Datos no válidos (${where}${issue?.message ?? "formato incorrecto"})`);
  }
  return r.data;
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  return parse(schema, await readJson(req));
}

/** Cadena opcional recortada a `max` caracteres (acepta null → null). */
export const str = (max: number) => z.string().transform((v) => v.slice(0, max));
/** Número que puede venir como texto desde un <input>. */
export const num = z.union([z.number(), z.string()]).transform((v) => (v === "" ? NaN : Number(v)));
/** Booleano que puede venir como "0"/"1". */
export const bool = z.union([z.boolean(), z.string(), z.number()]).transform((v) => !!v && v !== "0" && v !== "false");
export const id = z.string().min(1).max(64);
