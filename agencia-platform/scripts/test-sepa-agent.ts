/**
 * Tests (ejecutables con tsx, sin framework) de la fase 2:
 *   - Generador pain.008 (fallback): estructura, control de sumas, validación.
 *   - Invariantes de seguridad del contrato del agente (tipos/estados).
 *
 *   npx tsx scripts/test-sepa-agent.ts
 *
 * Sale con código != 0 si algún assert falla. NO toca la base de datos ni el banco.
 */
import { generatePain008 } from "../lib/facturacion/sepa/pain008";

let failed = 0;
function ok(cond: boolean, msg: string) {
  console.log((cond ? "✅" : "❌") + " " + msg);
  if (!cond) failed++;
}

// ---- pain.008 ----
const xml = generatePain008({
  messageId: "MSG-1",
  paymentInfoId: "PMT-1",
  creationDateTime: "2026-08-08T10:00:00",
  requestedCollectionDate: "2026-08-15",
  sequenceType: "RCUR",
  creditor: { name: "Negocio Vivo S.C.A.", iban: "ES9121000418450200051332", creditorId: "ES12ZZZ12345678Z" },
  debtors: [
    { name: "Cliente Uno SL", iban: "ES7620770024003102575766", amountCents: 12100, mandateId: "RUM-1", mandateSignatureDate: "2025-01-10", remittanceInfo: "Factura F-2026-001" },
    { name: "Cliente Dos SL", iban: "ES7100302053091234567895", amountCents: 5000, mandateId: "RUM-2", mandateSignatureDate: "2025-02-01" }
  ]
});

ok(xml.includes("pain.008.001.02"), "pain.008: espacio de nombres correcto");
ok(xml.includes("<PmtMtd>DD</PmtMtd>"), "pain.008: método de pago DD");
ok(xml.includes("<SeqTp>RCUR</SeqTp>"), "pain.008: secuencia RCUR");
ok((xml.match(/<DrctDbtTxInf>/g) || []).length === 2, "pain.008: dos transacciones");
ok(xml.includes("<NbOfTxs>2</NbOfTxs>"), "pain.008: NbOfTxs=2");
ok(xml.includes("<CtrlSum>171.00</CtrlSum>"), "pain.008: suma de control 171.00");
ok(xml.includes("ES9121000418450200051332"), "pain.008: IBAN acreedor presente");
ok(xml.includes("Factura F-2026-001"), "pain.008: concepto presente");
ok(!xml.includes("<InstdAmt Ccy=\"EUR\">0.00</InstdAmt>"), "pain.008: sin importes cero");

// Validaciones defensivas
let threw = false;
try { generatePain008({ messageId: "M", paymentInfoId: "P", creationDateTime: "x", requestedCollectionDate: "y", creditor: { name: "N", iban: "INVALID", creditorId: "C" }, debtors: [{ name: "D", iban: "ES7620770024003102575766", amountCents: 100, mandateId: "R", mandateSignatureDate: "2025-01-01" }] }); }
catch { threw = true; }
ok(threw, "pain.008: rechaza IBAN de acreedor inválido");

threw = false;
try { generatePain008({ messageId: "M", paymentInfoId: "P", creationDateTime: "x", requestedCollectionDate: "y", creditor: { name: "N", iban: "ES9121000418450200051332", creditorId: "C" }, debtors: [{ name: "D", iban: "ES7620770024003102575766", amountCents: 0, mandateId: "R", mandateSignatureDate: "2025-01-01" }] }); }
catch { threw = true; }
ok(threw, "pain.008: rechaza importe no positivo");

threw = false;
try { generatePain008({ messageId: "M", paymentInfoId: "P", creationDateTime: "x", requestedCollectionDate: "y", creditor: { name: "N", iban: "ES9121000418450200051332", creditorId: "C" }, debtors: [] }); }
catch { threw = true; }
ok(threw, "pain.008: rechaza remesa sin deudores");

// Escapado XML
const xml2 = generatePain008({
  messageId: "M&1", paymentInfoId: "P<1>", creationDateTime: "2026-08-08T10:00:00", requestedCollectionDate: "2026-08-15",
  creditor: { name: "Tom & Jerry <SL>", iban: "ES9121000418450200051332", creditorId: "C" },
  debtors: [{ name: "A & B", iban: "ES7620770024003102575766", amountCents: 100, mandateId: "R", mandateSignatureDate: "2025-01-01" }]
});
ok(xml2.includes("Tom &amp; Jerry &lt;SL&gt;"), "pain.008: escapa caracteres XML");

console.log(failed === 0 ? "\nTodos los tests de fase 2 (pain.008) OK" : `\n${failed} test(s) fallidos`);
if (failed > 0) process.exit(1);
