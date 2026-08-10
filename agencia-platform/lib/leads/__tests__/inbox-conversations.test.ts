/**
 * Tests del agregado/filtrado de conversaciones del inbox:
 *   - agrupado por teléfono (último mensaje, no-leídos, último entrante, cuenta).
 *   - flag `optedOut` desde el estado REAL de opt-out (por teléfono y por leadId).
 *   - filtro por bloqueado (all | blocked | unblocked) y su composición.
 */
import { describe, it, expect } from "vitest";
import { buildConversations, resolveAccountWhere, accountOptionsFromGroups, DEFAULT_ACCOUNT, type RawInboxMsg, type RawConvMeta } from "../inbox-conversations";

function msg(p: Partial<RawInboxMsg> & { phoneNormalized: string; direction: string; receivedAt: Date }): RawInboxMsg {
  return {
    fromPhone: p.phoneNormalized,
    body: p.body ?? "hola",
    meta: p.meta ?? null,
    read: p.read ?? true,
    instanceName: p.instanceName ?? null,
    classification: p.classification ?? null,
    lead: p.lead ?? null,
    ...p
  } as RawInboxMsg;
}

// Mensajes DESC por receivedAt (como los entrega la consulta).
const NOW = new Date("2026-06-15T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60000);

const META: RawConvMeta[] = [
  { phone: "34600111222", realPhone: "34600111222", displayName: "Bar Pepe", note: null, priority: "alta", status: "pending", archived: false, followupAt: null, aiScore: 80, aiCallNow: false }
];

describe("buildConversations — agregado por teléfono", () => {
  const msgs: RawInboxMsg[] = [
    msg({ phoneNormalized: "34600111222", direction: "out", body: "te respondo", receivedAt: ago(1), instanceName: "sonia4" }),
    msg({ phoneNormalized: "34600111222", direction: "in", body: "¿precio?", receivedAt: ago(5), read: false, instanceName: "sonia4", classification: "info_request", lead: { id: "lead-1", name: "Bar Pepe", phone: "34600111222" } }),
    msg({ phoneNormalized: "34600999888", direction: "in", body: "hola", receivedAt: ago(10), read: false, instanceName: "ZTE 644872463" })
  ];

  it("agrupa una fila por teléfono con último mensaje, no-leídos y cuenta", () => {
    const items = buildConversations(msgs, META, { optoutPhones: new Set(), optoutLeadIds: new Set() });
    expect(items).toHaveLength(2);
    const pepe = items.find((c) => c.phone === "34600111222")!;
    expect(pepe.lastBody).toBe("te respondo"); // el más reciente (desc)
    expect(pepe.lastDirection).toBe("out");
    expect(pepe.unread).toBe(1); // un entrante sin leer
    expect(pepe.lastInboundAt).toBe(ago(5).toISOString()); // último entrante
    expect(pepe.instanceName).toBe("sonia4"); // cuenta del entrante
    expect(pepe.classification).toBe("info_request");
    expect(pepe.leadId).toBe("lead-1");
  });

  it("ordena por prioridad y luego por actividad reciente", () => {
    const items = buildConversations(msgs, META, { optoutPhones: new Set(), optoutLeadIds: new Set() });
    // Bar Pepe (prioridad alta) va antes que el teléfono sin meta (none).
    expect(items[0].phone).toBe("34600111222");
  });
});

describe("optedOut — estado real de 'Bloquear para siempre'", () => {
  const base: RawInboxMsg[] = [
    msg({ phoneNormalized: "34600111222", direction: "in", body: "x", receivedAt: ago(5), lead: { id: "lead-1", name: "Bar Pepe", phone: "34600111222" } }),
    msg({ phoneNormalized: "34600999888", direction: "in", body: "y", receivedAt: ago(6) })
  ];

  it("marca optedOut por TELÉFONO", () => {
    const items = buildConversations(base, META, { optoutPhones: new Set(["34600999888"]), optoutLeadIds: new Set() });
    expect(items.find((c) => c.phone === "34600999888")!.optedOut).toBe(true);
    expect(items.find((c) => c.phone === "34600111222")!.optedOut).toBe(false);
  });

  it("marca optedOut por LEAD ID (opt-out sin teléfono coincidente)", () => {
    const items = buildConversations(base, META, { optoutPhones: new Set(), optoutLeadIds: new Set(["lead-1"]) });
    expect(items.find((c) => c.phone === "34600111222")!.optedOut).toBe(true);
  });

  it("filtro 'blocked' devuelve solo bloqueados; 'unblocked' solo no bloqueados; 'all' todos", () => {
    const opt = { optoutPhones: new Set(["34600999888"]), optoutLeadIds: new Set<string>() };
    expect(buildConversations(base, META, { ...opt, blocked: "blocked" }).map((c) => c.phone)).toEqual(["34600999888"]);
    expect(buildConversations(base, META, { ...opt, blocked: "unblocked" }).map((c) => c.phone)).toEqual(["34600111222"]);
    expect(buildConversations(base, META, { ...opt, blocked: "all" })).toHaveLength(2);
  });
});

describe("filtro por cuenta de WhatsApp (incl. 'default' = instanceName null)", () => {
  it("resolveAccountWhere: all/vacío → sin filtro; nombre → igualdad; default → null", () => {
    expect(resolveAccountWhere("all")).toEqual({});
    expect(resolveAccountWhere("")).toEqual({});
    expect(resolveAccountWhere(null)).toEqual({});
    expect(resolveAccountWhere("sonia4")).toEqual({ instanceName: "sonia4" });
    expect(resolveAccountWhere("ZTE 644872463")).toEqual({ instanceName: "ZTE 644872463" });
    expect(resolveAccountWhere(DEFAULT_ACCOUNT)).toEqual({ instanceName: null });
  });

  it("accountOptionsFromGroups: nombres únicos ordenados + 'default' si hay instanceName null", () => {
    const opts = accountOptionsFromGroups([
      { instanceName: "sonia4" },
      { instanceName: null }, // cuenta principal
      { instanceName: "ZTE 644063050" },
      { instanceName: "sonia4" }, // duplicado
      { instanceName: "ZTE 644872463" },
      { instanceName: "  " } // vacío → se ignora
    ]);
    expect(opts[0]).toBe(DEFAULT_ACCOUNT); // default primero
    // Orden alfabético insensible a mayúsculas (localeCompare): s < z.
    expect(opts.slice(1)).toEqual(["sonia4", "ZTE 644063050", "ZTE 644872463"]);
  });

  it("accountOptionsFromGroups: sin nulls, no añade 'default'", () => {
    const opts = accountOptionsFromGroups([{ instanceName: "sonia4" }]);
    expect(opts).toEqual(["sonia4"]);
  });
});

describe("composición: cuenta + bloqueado", () => {
  it("respeta la cuenta ya filtrada en consulta y aplica bloqueado encima", () => {
    // Simula que la consulta ya trajo solo mensajes de 'sonia4'.
    const soniaMsgs: RawInboxMsg[] = [
      msg({ phoneNormalized: "34600111222", direction: "in", body: "a", receivedAt: ago(3), instanceName: "sonia4", lead: { id: "lead-1", name: "Bar Pepe", phone: "34600111222" } }),
      msg({ phoneNormalized: "34600555444", direction: "in", body: "b", receivedAt: ago(4), instanceName: "sonia4" })
    ];
    const items = buildConversations(soniaMsgs, META, { optoutPhones: new Set(["34600555444"]), optoutLeadIds: new Set(), blocked: "unblocked" });
    expect(items.map((c) => c.phone)).toEqual(["34600111222"]);
    expect(items.every((c) => c.instanceName === "sonia4" || c.instanceName === null)).toBe(true);
  });
});
