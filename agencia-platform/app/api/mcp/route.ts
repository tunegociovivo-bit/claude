import { NextRequest, NextResponse } from "next/server";
import { authenticate, ApiError, errorResponse } from "@/lib/api/auth";
import { mcpTools } from "@/lib/mcp/tools";

// Implementación mínima del protocolo MCP (JSON-RPC sobre HTTP).
// Soporta: initialize, tools/list, tools/call.
// Auth: Authorization: Bearer ag_<prefix>.<secret>

export async function POST(req: NextRequest) {
  try {
    const ctx = await authenticate(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "bad_request", "JSON inválido");

    const { id, method, params } = body as { id: any; method: string; params?: any };

    const respond = (result: any) => NextResponse.json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: 200 });

    if (method === "initialize") {
      return respond({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agencia-hub", version: "1.0.0" }
      });
    }

    if (method === "tools/list") {
      return respond({
        tools: mcpTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params ?? {};
      const tool = mcpTools.find((t) => t.name === name);
      if (!tool) return fail(-32601, `Tool desconocido: ${name}`);
      try {
        const data = await tool.handler(args ?? {}, ctx);
        return respond({
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          isError: false
        });
      } catch (e: any) {
        return respond({
          content: [{ type: "text", text: `Error: ${e?.message ?? "desconocido"}` }],
          isError: true
        });
      }
    }

    return fail(-32601, `Método no soportado: ${method}`);
  } catch (err) {
    return errorResponse(err);
  }
}

export function GET() {
  return NextResponse.json({
    name: "Agencia Hub MCP server",
    transport: "Streamable HTTP",
    endpoint: "/api/mcp",
    auth: "Authorization: Bearer ag_<prefix>.<secret>",
    methods: ["initialize", "tools/list", "tools/call"]
  });
}
