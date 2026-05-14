import { NextRequest, NextResponse } from "next/server";
import { authenticate, errorResponse, requireScope, type ApiContext } from "./auth";

type Handler = (req: NextRequest, ctx: { params: any; api: ApiContext }) => Promise<NextResponse>;

export function withApi(opts: { scope?: string }, handler: Handler) {
  return async (req: NextRequest, ctx: { params: any }) => {
    try {
      const api = await authenticate(req);
      if (opts.scope) requireScope(api, opts.scope);
      return await handler(req, { ...ctx, api });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
