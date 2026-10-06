import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/auth";
import { isModuleEnabled, MODULE_LABELS, type ContentModule } from "@/lib/modules";
import { authenticate, errorResponse, requireAdminRole, requireScope, ApiError, type ApiContext } from "./auth";
import { rateLimit } from "./rate-limit";
import { assertAiBudget } from "@/lib/content/ai-budget";

type Handler = (req: NextRequest, ctx: { params: any; api: ApiContext }) => Promise<NextResponse | Response>;

const LIMITS = { read: 240, write: 60 };
const CATEGORY_LIMITS = { ai: 15, admin: 30, destructive: 10 } as const;
export type RateCategory = keyof typeof CATEGORY_LIMITS | undefined;

export type WithApiOpts = {
  scope?: string;
  rate?: RateCategory;
  rateLimit?: { user?: number };
  /** Exige rol ADMIN del workspace. */
  admin?: boolean;
  /** Módulo que debe estar activo en el workspace (lo activa Negocio Vivo). */
  module?: ContentModule;
};

export function withApi(opts: WithApiOpts, handler: Handler) {
  return async (req: NextRequest, ctx: { params: any }) => {
    try {
      const isWrite = req.method !== "GET" && req.method !== "HEAD";
      // CSRF: las escrituras solo se aceptan desde el propio origen.
      if (isWrite && !isSameOrigin(req)) throw new ApiError(403, "bad_origin", "Origen no permitido");
      const api = await authenticate(req);
      if (opts.scope) requireScope(api, opts.scope);
      if (opts.admin) requireAdminRole(api);
      if (opts.module && !(await isModuleEnabled(api.workspaceId, opts.module))) {
        throw new ApiError(403, "module_disabled", `El módulo ${MODULE_LABELS[opts.module]} no está activo en tu cuenta. Pídeselo a Negocio Vivo.`);
      }

      // Endpoints de IA: tope mensual de gasto por negocio (claves de Negocio Vivo).
      if (opts.rate === "ai" && isWrite) await assertAiBudget(api.workspaceId);

      const limit = opts.rateLimit?.user ?? (opts.rate ? CATEGORY_LIMITS[opts.rate] : isWrite ? LIMITS.write : LIMITS.read);
      const key = `user:${api.userId}:${opts.rateLimit ? "custom" : opts.rate ?? (isWrite ? "w" : "r")}`;
      const rl = rateLimit(key, limit);
      if (!rl.ok) {
        const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
        return NextResponse.json(
          { error: { code: "rate_limited", message: `Demasiadas peticiones seguidas. Espera ${retryAfter}s.` } },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        );
      }

      const res = await handler(req, { ...ctx, params: await ctx.params, api });
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store, must-revalidate");
      return res;
    } catch (err) {
      // Señales internas de Next (render dinámico) no son errores de la ruta.
      if ((err as { digest?: string })?.digest === "DYNAMIC_SERVER_USAGE") throw err;
      return errorResponse(err);
    }
  };
}
