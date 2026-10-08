import { describe, expect, it } from "vitest";
import {
  assignManualRemittances,
  assignRemittanceGroups,
  duplicateRemittanceRowIds,
  isRemittanceAggregate,
  remittanceCode,
  suggestInvoicesForMovement
} from "../remittances";

const at = (day: string, hour = "12:00") => new Date(`${day}T${hour}:00.000Z`);
const agg = (id: string, eur: number, day: string) => ({ id, amountCents: Math.round(eur * 100), bookedAt: at(day), code: id });
const req = (id: string, eur: number, day: string, hour = "07:00") => ({ id, amountCents: Math.round(eur * 100), preparedAt: at(day, hour) });

describe("número de remesa", () => {
  it("lee el número del listado y del movimiento de cuenta sin pegar la fecha", () => {
    expect(remittanceCode("Remesa SEPA 0049661175300006H7 · Contabilizada")).toBe("0049661175300006H7");
    expect(remittanceCode("Emision Remesa Sepa Sdd Referencia: 0049 6611 753 000066s 09/09/2026 1.391,50 EUR 17.110,30 EUR")).toBe("00496611753000066S");
    expect(remittanceCode("Emision Remesa Sepa Sdd Referencia: 0049 6611 753 000065C")).toBe("00496611753000065C");
  });

  it("distingue abonos agregados de recibos y transferencias", () => {
    expect(isRemittanceAggregate("Remesa SEPA 0049661175300006H7 · Contabilizada")).toBe(true);
    expect(isRemittanceAggregate("Emision Remesa Sepa Sdd Referencia: 0049 6611 753 000066s 09/09/2026")).toBe(true);
    expect(isRemittanceAggregate("Remesa SEPA 0049661175300006HH · Recibo 00496611754000112C · Orden liquidada")).toBe(false);
    expect(isRemittanceAggregate("Remesa SEPA 5ZY · Factura FAC-003019 · Orden liquidada")).toBe(false);
    expect(isRemittanceAggregate("Transferencia Inmediata De Reformas Orce")).toBe(false);
  });

  it("ignora la copia de la misma remesa que entra por la cuenta", () => {
    const created = at("2026-09-09");
    expect(duplicateRemittanceRowIds([
      { id: "list", status: "UNMATCHED", amountCents: 139150, reference: "Remesa SEPA 00496611753000066S · Contabilizada", createdAt: created },
      { id: "account", status: "UNMATCHED", amountCents: 139150, reference: "Emision Remesa Sepa Sdd Referencia: 0049 6611 753 000066s 09/09/2026 1.391,50 EUR", createdAt: created }
    ])).toEqual(["account"]);
    expect(duplicateRemittanceRowIds([
      { id: "list", status: "UNMATCHED", amountCents: 60500, reference: "Remesa SEPA 00496611753000066Q · Contabilizada", createdAt: created },
      { id: "account", status: "MATCHED", amountCents: 60500, reference: "Emision Remesa Sepa Sdd Referencia: 0049 6611 753 000066q 09/09/2026 605,00 EUR", createdAt: created }
    ])).toEqual(["list"]);
  });
});

describe("remesas preparadas por el HUB", () => {
  it("concilia un abono único con su remesa", () => {
    const { assignments } = assignRemittanceGroups([agg("6H9", 605, "2026-10-06")], [req("cerrajero", 605, "2026-10-03")]);
    expect(assignments).toEqual([{ aggregateId: "6H9", requestId: "cerrajero", windowDays: 7 }]);
  });

  it("concilia un grupo del mismo importe cuando cuadran abonos y remesas", () => {
    const { assignments } = assignRemittanceGroups(
      [agg("6FC", 484, "2026-10-02"), agg("6H7", 484, "2026-10-06"), agg("6HK", 484, "2026-10-06")],
      [req("automatic", 484, "2026-10-01"), req("mudanzas", 484, "2026-10-03"), req("aquaking", 484, "2026-10-05")]
    );
    expect(assignments).toHaveLength(3);
    expect(assignments.find((a) => a.requestId === "automatic")?.aggregateId).toBe("6FC");
  });

  it("deja en revisión si sobran abonos (puede ser una remesa manual de otro cliente)", () => {
    const { assignments, contested } = assignRemittanceGroups(
      [agg("68G", 756.25, "2026-09-10"), agg("68Q", 756.25, "2026-09-14")],
      [req("abundancia", 756.25, "2026-09-10")]
    );
    expect(assignments).toEqual([]);
    expect([...contested].sort()).toEqual(["68G", "68Q"]);
  });

  it("deja en revisión si faltan abonos", () => {
    const { assignments } = assignRemittanceGroups(
      [agg("69H", 363, "2026-09-17")],
      [req("rs", 363, "2026-09-10"), req("cliniolmo", 363, "2026-09-15")]
    );
    expect(assignments).toEqual([]);
  });

  it("nunca empareja un abono anterior a la preparación ni de otro importe", () => {
    const { assignments } = assignRemittanceGroups(
      [agg("A", 242, "2026-09-30"), agg("B", 243, "2026-10-02")],
      [req("R", 242, "2026-10-01")]
    );
    expect(assignments).toEqual([]);
  });

  it("amplía a 12 días solo lo que quedó pendiente con 7", () => {
    const { assignments } = assignRemittanceGroups(
      [agg("66S", 1391.5, "2026-09-09"), agg("66Z", 1391.5, "2026-09-16")],
      [req("ayc", 1391.5, "2026-09-07", "11:50"), req("odonto", 1391.5, "2026-09-07", "11:51")]
    );
    expect(assignments.map((a) => a.windowDays)).toEqual([12, 12]);
    expect(new Set(assignments.map((a) => a.requestId))).toEqual(new Set(["ayc", "odonto"]));
  });
});

describe("remesas manuales", () => {
  const invoices = [
    { id: "rochar-oct", totalCents: 111229, issueDate: at("2026-10-02") },
    { id: "rochar-sep", totalCents: 81070, issueDate: at("2026-09-28") },
    { id: "rochar-jun", totalCents: 81070, issueDate: at("2026-06-27") },
    { id: "legion-a", totalCents: 21780, issueDate: at("2026-08-04") },
    { id: "legion-b", totalCents: 21780, issueDate: at("2026-09-04") }
  ];

  it("concilia solo cuando el importe identifica una única factura y un único abono", () => {
    expect(assignManualRemittances(
      [agg("6HH", 1112.29, "2026-10-06"), agg("6DS", 810.7, "2026-10-01"), agg("68S", 217.8, "2026-09-15")],
      invoices
    )).toEqual([
      { aggregateId: "6HH", invoiceId: "rochar-oct" },
      { aggregateId: "6DS", invoiceId: "rochar-sep" }
    ]);
  });

  it("no concilia si dos abonos podrían ser la misma factura", () => {
    expect(assignManualRemittances([agg("X", 1112.29, "2026-10-06"), agg("Y", 1112.29, "2026-10-07")], invoices)).toEqual([]);
  });

  it("sugiere facturas del mismo importe por cercanía", () => {
    expect(suggestInvoicesForMovement({ amountCents: 21780, bookedAt: at("2026-09-15") }, invoices).map((i) => i.id)).toEqual(["legion-b", "legion-a"]);
  });
});
