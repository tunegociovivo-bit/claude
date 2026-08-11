/**
 * Slice A — importador puro: parseo CSV, saneado anti-inyección, mapeo, validación
 * por fila, céntimos/impuestos, dedupe/idempotencia (checksum), datos parciales.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, sanitizeCell, eurosToCents, parseIsoDate, buildTemplates, previewCsv, previewJson, checksumOf } from "../import";

describe("parseCsv", () => {
  it("respeta comillas, comas y saltos escapados", () => {
    const grid = parseCsv('a,b\n"x,y","he said ""hi"""\n');
    expect(grid).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"']
    ]);
  });
  it("ignora filas totalmente vacías", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"]
    ]);
  });
});

describe("sanitizeCell — anti formula injection", () => {
  it("neutraliza celdas que empiezan por = + - @", () => {
    expect(sanitizeCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(sanitizeCell("+1")).toBe("'+1");
    expect(sanitizeCell("-2")).toBe("'-2");
    expect(sanitizeCell("@cmd")).toBe("'@cmd");
    expect(sanitizeCell("normal")).toBe("normal");
  });
});

describe("eurosToCents", () => {
  it("acepta formatos ES/EN y símbolos", () => {
    expect(eurosToCents("10,50")).toBe(1050);
    expect(eurosToCents("10.50")).toBe(1050);
    expect(eurosToCents("1.234,56")).toBe(123456);
    expect(eurosToCents("1,234.56")).toBe(123456);
    expect(eurosToCents("€ 99")).toBe(9900);
    expect(eurosToCents(12.34)).toBe(1234);
    expect(eurosToCents("abc")).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("dd/mm/yyyy e ISO; basura → null", () => {
    expect(parseIsoDate("15/03/2026")?.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(parseIsoDate("2026-03-15")?.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(parseIsoDate("no-fecha")).toBeNull();
  });
});

const CSV_OK = [
  "externalId,clientName,clientTaxId,description,unitPrice,quantity,taxRate,intervalMonths,dayOfMonth,startDate,paymentMethod",
  "HLD-1,Acme SL,B12345678,Cuota mantenimiento,100,1,21,1,1,01/01/2026,TRANSFER",
  "HLD-2,Beta SA,A87654321,Hosting anual,1.200,1,21,12,15,01/02/2026,REMITTANCE"
].join("\n");

describe("buildTemplates / previewCsv — mapeo + totales", () => {
  it("mapea, calcula céntimos e impuestos, marca válidas", () => {
    const p = previewCsv(CSV_OK);
    expect(p.total).toBe(2);
    expect(p.valid).toBe(2);
    expect(p.invalid).toBe(0);
    const acme = p.items.find((i) => i.externalId === "HLD-1")!.template!;
    expect(acme.subtotalCents).toBe(10000); // 100€
    expect(acme.taxCents).toBe(2100); // 21%
    expect(acme.totalCents).toBe(12100);
    expect(acme.intervalMonths).toBe(1);
    const beta = p.items.find((i) => i.externalId === "HLD-2")!.template!;
    expect(beta.subtotalCents).toBe(120000); // 1.200€
    expect(beta.intervalMonths).toBe(12);
    expect(beta.paymentMethod).toBe("REMITTANCE");
  });

  it("agrupa varias filas con el mismo externalId en una plantilla multi-línea", () => {
    const csv = [
      "externalId,clientName,description,unitPrice,taxRate",
      "T1,Acme,Línea A,10,21",
      "T1,Acme,Línea B,5,10"
    ].join("\n");
    const p = previewCsv(csv);
    expect(p.total).toBe(1);
    expect(p.items[0].template!.lines).toHaveLength(2);
    expect(p.items[0].template!.subtotalCents).toBe(1500);
  });
});

describe("validación por fila (errores concretos, no todo-o-nada)", () => {
  it("reporta IVA inválido, importe no numérico, periodicidad y cliente faltante", () => {
    const csv = [
      "externalId,clientName,description,unitPrice,taxRate,intervalMonths",
      "BAD-1,,Concepto,abc,21,1", // sin cliente + importe malo
      "BAD-2,Cli,Concepto,10,17,99" // IVA 17 inválido + interval 99 > 60
    ].join("\n");
    const p = previewCsv(csv);
    expect(p.valid).toBe(0);
    expect(p.invalid).toBe(2);
    const b1 = p.items.find((i) => i.externalId === "BAD-1")!;
    expect(b1.errors.some((e) => e.field === "client")).toBe(true);
    expect(b1.errors.some((e) => e.field.includes("unitPrice"))).toBe(true);
    const b2 = p.items.find((i) => i.externalId === "BAD-2")!;
    expect(b2.errors.some((e) => e.field.includes("taxRate"))).toBe(true);
    expect(b2.errors.some((e) => e.field === "intervalMonths")).toBe(true);
  });
  it("dayOfMonth > 28 se rechaza (fin de mes seguro)", () => {
    const csv = "externalId,clientName,description,unitPrice,taxRate,dayOfMonth\nX,Cli,C,10,21,31";
    expect(previewCsv(csv).items[0].errors.some((e) => e.field === "dayOfMonth")).toBe(true);
  });
});

describe("CSV malicioso — la fórmula se neutraliza en descripción/cliente", () => {
  it("no ejecuta; el valor queda con apóstrofo", () => {
    const csv = "externalId,clientName,description,unitPrice,taxRate\nX,=HYPERLINK(1),=cmd|calc,10,21";
    const t = previewCsv(csv).items[0].template!;
    expect(t.clientName).toBe("'=HYPERLINK(1)");
    expect(t.lines[0].description).toBe("'=cmd|calc");
  });
});

describe("dedupe / idempotencia (checksum)", () => {
  it("mismo contenido → mismo checksum; cambio de importe → distinto", () => {
    const a = previewCsv(CSV_OK).items[0].template!;
    const b = previewCsv(CSV_OK).items[0].template!;
    expect(a.checksum).toBe(b.checksum);
    const changed = previewCsv(CSV_OK.replace("100,1,21", "200,1,21")).items[0].template!;
    expect(changed.checksum).not.toBe(a.checksum);
  });
  it("duplicado por CONTENIDO se cuenta (aunque el externalId difiera)", () => {
    const csv = [
      "externalId,clientName,description,unitPrice,taxRate",
      "DUP,Acme,C,10,21",
      "DUP2,Acme,C,10,21" // mismo contenido, distinto externalId → 1 duplicado
    ].join("\n");
    expect(previewCsv(csv).total).toBe(2);
    expect(previewCsv(csv).duplicatesInFile).toBe(1);
    // 'SAME' repetido agrupa en UNA plantilla multi-línea → 1 item
    const same = "externalId,clientName,description,unitPrice,taxRate\nSAME,Acme,C,10,21\nSAME,Acme,C,10,21";
    expect(previewCsv(same).total).toBe(1);
  });
});

describe("folded review — IVA estricto, sin fallback a 21%", () => {
  it("'10%' / 'exento' / vacío → ERROR de IVA (no se asume 21%)", () => {
    const mk = (iva: string) => `externalId,clientName,description,unitPrice,taxRate\nX,Cli,C,10,${iva}`;
    expect(previewCsv(mk("10%")).items[0].errors.some((e) => e.field.includes("taxRate"))).toBe(false); // 10% → 10 válido
    expect(previewCsv(mk("10%")).items[0].template!.lines[0].taxRate).toBe(10);
    expect(previewCsv(mk("exento")).items[0].errors.some((e) => e.field.includes("taxRate"))).toBe(true);
    expect(previewCsv(mk("")).items[0].errors.some((e) => e.field.includes("taxRate"))).toBe(true);
    expect(previewCsv(mk("17")).items[0].errors.some((e) => e.field.includes("taxRate"))).toBe(true); // no permitido
  });
});

describe("folded review — importe negativo / overflow / día no entero", () => {
  it("negativo y overflow se rechazan", () => {
    expect(previewCsv("externalId,clientName,description,unitPrice,taxRate\nX,Cli,C,-10,21").items[0].errors.some((e) => e.message.includes("negativo"))).toBe(true);
    expect(previewCsv("externalId,clientName,description,unitPrice,taxRate\nX,Cli,C,50000000,21").items[0].errors.some((e) => e.message.includes("grande"))).toBe(true);
  });
  it("dayOfMonth no entero se rechaza", () => {
    expect(previewCsv("externalId,clientName,description,unitPrice,taxRate,dayOfMonth\nX,Cli,C,10,21,15.5").items[0].errors.some((e) => e.field === "dayOfMonth")).toBe(true);
  });
});

describe("folded review — externalId sintético es CONTENT-based (sin colisión entre ficheros)", () => {
  it("filas sin externalId → clave auto-<checksum>, no posición", () => {
    const a = previewCsv("clientName,description,unitPrice,taxRate\nAcme,C,10,21").items[0].externalId;
    const b = previewCsv("clientName,description,unitPrice,taxRate\nBeta,D,20,21").items[0].externalId;
    expect(a).toMatch(/^auto-/);
    expect(b).toMatch(/^auto-/);
    expect(a).not.toBe(b); // contenido distinto → clave distinta (no machaca)
    // mismo contenido → misma clave (idempotente entre ficheros)
    const a2 = previewCsv("clientName,description,unitPrice,taxRate\nAcme,C,10,21").items[0].externalId;
    expect(a2).toBe(a);
  });
});

describe("folded review — checksum sensible a método de pago/fechas", () => {
  it("cambiar paymentMethod cambia el checksum (no se salta el update)", () => {
    const base = "externalId,clientName,description,unitPrice,taxRate,paymentMethod\nT,Cli,C,10,21,TRANSFER";
    const changed = "externalId,clientName,description,unitPrice,taxRate,paymentMethod\nT,Cli,C,10,21,REMITTANCE";
    expect(previewCsv(base).items[0].template!.checksum).not.toBe(previewCsv(changed).items[0].template!.checksum);
  });
});

describe("previewJson", () => {
  it("acepta records JSON directos", () => {
    const p = previewJson([{ externalId: "J1", clientName: "Cli", description: "C", unitPrice: "50", taxRate: "10" }]);
    expect(p.valid).toBe(1);
    expect(p.items[0].template!.taxCents).toBe(500); // 50€ * 10%
  });
});
