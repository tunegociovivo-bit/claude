/**
 * Generador de fichero SEPA pain.008.001.02 (adeudos directos / Norma 19-14).
 *
 * ⚠️ ESTO ES UN FALLBACK. El flujo principal es que el agente prepare la remesa
 * dentro de Santander Empresas (reutilizando la anterior) y la deje pendiente de
 * firma. Este generador NO sustituye esa subida: sirve solo como red de
 * seguridad si se necesitara subir un fichero manualmente al portal.
 *
 * IMPORTANTE sobre privacidad: pain.008 requiere el IBAN COMPLETO del deudor,
 * que el HUB NO almacena (solo guarda el enmascarado). Por eso los IBAN completos
 * deben pasarse explícitamente al llamar a esta función y NUNCA se persisten.
 * Generar el fichero no firma ni ejecuta ningún cobro.
 */

export interface Pain008Creditor {
  name: string;
  iban: string;        // IBAN completo del acreedor (Negocio Vivo)
  bic?: string;
  /** Identificador del acreedor SEPA (p. ej. ES + dígito control + sufijo + NIF). */
  creditorId: string;
}

export interface Pain008Debtor {
  name: string;
  iban: string;            // IBAN completo del deudor (no se persiste)
  bic?: string;
  amountCents: number;
  mandateId: string;       // RUM (referencia única de mandato)
  mandateSignatureDate: string; // YYYY-MM-DD
  remittanceInfo?: string; // concepto (p. ej. nº de factura)
  endToEndId?: string;
}

export interface Pain008Options {
  messageId: string;
  paymentInfoId: string;
  creationDateTime: string; // ISO 8601
  requestedCollectionDate: string; // YYYY-MM-DD
  currency?: string; // por defecto EUR
  /** FRST (primer adeudo del mandato) o RCUR (recurrente). Por defecto RCUR. */
  sequenceType?: "FRST" | "RCUR" | "OOFF" | "FNAL";
  creditor: Pain008Creditor;
  debtors: Pain008Debtor[];
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

function amount(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("Importe inválido (céntimos enteros positivos)");
  return (cents / 100).toFixed(2);
}

function normIban(iban: string): string {
  const v = iban.replace(/\s+/g, "").toUpperCase();
  if (!IBAN_RE.test(v)) throw new Error(`IBAN inválido: ${iban.slice(0, 4)}…`);
  return v;
}

export function generatePain008(opts: Pain008Options): string {
  if (!opts.debtors.length) throw new Error("Sin deudores");
  const ccy = opts.currency ?? "EUR";
  const seq = opts.sequenceType ?? "RCUR";
  const creditorIban = normIban(opts.creditor.iban);

  const nbOfTxs = opts.debtors.length;
  const ctrlSumCents = opts.debtors.reduce((s, d) => s + d.amountCents, 0);
  const ctrlSum = (ctrlSumCents / 100).toFixed(2);

  const txs = opts.debtors.map((d, i) => {
    const iban = normIban(d.iban);
    const e2e = xmlEscape(d.endToEndId ?? `${opts.paymentInfoId}-${i + 1}`);
    const info = d.remittanceInfo ? `\n          <RmtInf><Ustrd>${xmlEscape(d.remittanceInfo)}</Ustrd></RmtInf>` : "";
    const dbtrBic = d.bic ? `\n          <DbtrAgt><FinInstnId><BIC>${xmlEscape(d.bic)}</BIC></FinInstnId></DbtrAgt>` : `\n          <DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>`;
    return `        <DrctDbtTxInf>
          <PmtId><EndToEndId>${e2e}</EndToEndId></PmtId>
          <InstdAmt Ccy="${ccy}">${amount(d.amountCents)}</InstdAmt>
          <DrctDbtTx><MndtRltdInf><MndtId>${xmlEscape(d.mandateId)}</MndtId><DtOfSgntr>${xmlEscape(d.mandateSignatureDate)}</DtOfSgntr></MndtRltdInf></DrctDbtTx>${dbtrBic}
          <Dbtr><Nm>${xmlEscape(d.name)}</Nm></Dbtr>
          <DbtrAcct><Id><IBAN>${iban}</IBAN></Id></DbtrAcct>${info}
        </DrctDbtTxInf>`;
  }).join("\n");

  const cdtrBic = opts.creditor.bic ? `<CdtrAgt><FinInstnId><BIC>${xmlEscape(opts.creditor.bic)}</BIC></FinInstnId></CdtrAgt>` : `<CdtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></CdtrAgt>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${xmlEscape(opts.messageId)}</MsgId>
      <CreDtTm>${xmlEscape(opts.creationDateTime)}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <InitgPty><Nm>${xmlEscape(opts.creditor.name)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xmlEscape(opts.paymentInfoId)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSum}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${seq}</SeqTp></PmtTpInf>
      <ReqdColltnDt>${xmlEscape(opts.requestedCollectionDate)}</ReqdColltnDt>
      <Cdtr><Nm>${xmlEscape(opts.creditor.name)}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${creditorIban}</IBAN></Id></CdtrAcct>
      ${cdtrBic}
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${xmlEscape(opts.creditor.creditorId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${txs}
    </PmtInf>
  </CstmrDrctDbtInitn>
</Document>`;
}
