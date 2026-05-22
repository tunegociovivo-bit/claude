import type { InvoiceLine, InvoiceTotals } from "./core";

/**
 * Generador de Facturae 3.2.2 (formato factura electrónica español).
 *
 * FASE 1: genera el XML estructuralmente correcto SIN firma electrónica.
 * La firma XAdES-EPES (obligatoria para validez legal plena ante FACe /
 * administraciones públicas) se añadirá en fase 2 con el certificado del
 * emisor. El XML sin firmar ya sirve para muchos clientes privados que
 * solo piden "el Facturae".
 */

export type FacturaeParty = {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string | null; // ISO alpha-3
  personType?: string | null; // F | J
  residenceType?: string | null; // R | E | U
};

export type FacturaeInput = {
  number: string;
  issueDate: Date;
  currency: string; // EUR | USD
  issuer: FacturaeParty;
  client: FacturaeParty;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function dec(cents: number): string {
  return ((cents || 0) / 100).toFixed(2);
}
function num(n: number, digits = 2): string {
  return (Number(n) || 0).toFixed(digits);
}
function ymd(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function partyXml(p: FacturaeParty, tag: "SellerParty" | "BuyerParty"): string {
  const personType = (p.personType ?? "J").toUpperCase() === "F" ? "F" : "J";
  const residence = (p.residenceType ?? "R").toUpperCase();
  const country = (p.countryCode ?? "ESP").toUpperCase();
  const isSpain = country === "ESP";

  const addressBlock = isSpain
    ? `<AddressInSpain>
            <Address>${esc(p.address ?? "")}</Address>
            <PostCode>${esc(p.postalCode ?? "")}</PostCode>
            <Town>${esc(p.city ?? "")}</Town>
            <Province>${esc(p.province ?? p.city ?? "")}</Province>
            <CountryCode>${esc(country)}</CountryCode>
          </AddressInSpain>`
    : `<OverseasAddress>
            <Address>${esc(p.address ?? "")}</Address>
            <PostCodeAndTown>${esc(`${p.postalCode ?? ""} ${p.city ?? ""}`.trim())}</PostCodeAndTown>
            <Province>${esc(p.province ?? p.city ?? "")}</Province>
            <CountryCode>${esc(country)}</CountryCode>
          </OverseasAddress>`;

  let identity: string;
  if (personType === "F") {
    const parts = (p.name ?? "").trim().split(/\s+/);
    const firstName = parts.shift() ?? p.name ?? "";
    const surname = parts.join(" ") || ".";
    identity = `<Individual>
          <Name>${esc(firstName)}</Name>
          <FirstSurname>${esc(surname)}</FirstSurname>
          ${addressBlock}
        </Individual>`;
  } else {
    identity = `<LegalEntity>
          <CorporateName>${esc(p.legalName || p.name)}</CorporateName>
          ${addressBlock}
        </LegalEntity>`;
  }

  return `<${tag}>
        <TaxIdentification>
          <PersonTypeCode>${personType}</PersonTypeCode>
          <ResidenceTypeCode>${residence}</ResidenceTypeCode>
          <TaxIdentificationNumber>${esc(p.taxId ?? "")}</TaxIdentificationNumber>
        </TaxIdentification>
        ${identity}
      </${tag}>`;
}

export function buildFacturaeXml(input: FacturaeInput): string {
  const { totals } = input;
  const currency = (input.currency || "EUR").toUpperCase();

  const taxesOutputs = totals.taxBreakdown
    .map(
      (t) => `<Tax>
            <TaxTypeCode>01</TaxTypeCode>
            <TaxRate>${num(t.rate)}</TaxRate>
            <TaxableBase><TotalAmount>${dec(t.baseCents)}</TotalAmount></TaxableBase>
            <TaxAmount><TotalAmount>${dec(t.taxCents)}</TotalAmount></TaxAmount>
          </Tax>`
    )
    .join("\n          ");

  const items = input.lines
    .map((ln) => {
      const qty = Number(ln.quantity) || 0;
      const unit = (Number(ln.unitPriceCents) || 0) / 100;
      const disc = Math.min(Math.max(Number(ln.discountPct) || 0, 0), 100);
      const gross = Math.round(qty * (ln.unitPriceCents || 0));
      const discountCents = Math.round((gross * disc) / 100);
      const netCents = gross - discountCents;
      const taxCents = Math.round((netCents * (Number(ln.taxRate) || 0)) / 100);
      const discountBlock =
        disc > 0
          ? `<DiscountsAndRebates>
              <Discount>
                <DiscountReason>Descuento</DiscountReason>
                <DiscountRate>${num(disc)}</DiscountRate>
                <DiscountAmount>${dec(discountCents)}</DiscountAmount>
              </Discount>
            </DiscountsAndRebates>`
          : "";
      return `<InvoiceLine>
            <ItemDescription>${esc(ln.description)}</ItemDescription>
            <Quantity>${num(qty, 2)}</Quantity>
            <UnitOfMeasure>01</UnitOfMeasure>
            <UnitPriceWithoutTax>${num(unit, 6)}</UnitPriceWithoutTax>
            <TotalCost>${dec(gross)}</TotalCost>
            ${discountBlock}
            <GrossAmount>${dec(netCents)}</GrossAmount>
            <TaxesOutputs>
              <Tax>
                <TaxTypeCode>01</TaxTypeCode>
                <TaxRate>${num(Number(ln.taxRate) || 0)}</TaxRate>
                <TaxableBase><TotalAmount>${dec(netCents)}</TotalAmount></TaxableBase>
                <TaxAmount><TotalAmount>${dec(taxCents)}</TotalAmount></TaxAmount>
              </Tax>
            </TaxesOutputs>
          </InvoiceLine>`;
    })
    .join("\n          ");

  const grossBeforeTaxes = totals.subtotalCents; // base imponible total
  return `<?xml version="1.0" encoding="UTF-8"?>
<fe:Facturae xmlns:fe="http://www.facturae.es/Facturae/2014/v3.2.2/Facturae">
  <FileHeader>
    <SchemaVersion>3.2.2</SchemaVersion>
    <Modality>I</Modality>
    <InvoiceIssuerType>EM</InvoiceIssuerType>
    <Batch>
      <BatchIdentifier>${esc(input.number)}</BatchIdentifier>
      <InvoicesCount>1</InvoicesCount>
      <TotalInvoicesAmount><TotalAmount>${dec(totals.totalCents)}</TotalAmount></TotalInvoicesAmount>
      <TotalOutstandingAmount><TotalAmount>${dec(totals.totalCents)}</TotalAmount></TotalOutstandingAmount>
      <TotalExecutableAmount><TotalAmount>${dec(totals.totalCents)}</TotalAmount></TotalExecutableAmount>
      <InvoiceCurrencyCode>${esc(currency)}</InvoiceCurrencyCode>
    </Batch>
  </FileHeader>
  <Parties>
    ${partyXml(input.issuer, "SellerParty")}
    ${partyXml(input.client, "BuyerParty")}
  </Parties>
  <Invoices>
    <Invoice>
      <InvoiceHeader>
        <InvoiceNumber>${esc(input.number)}</InvoiceNumber>
        <InvoiceDocumentType>FC</InvoiceDocumentType>
        <InvoiceClass>OO</InvoiceClass>
      </InvoiceHeader>
      <InvoiceIssueData>
        <IssueDate>${ymd(input.issueDate)}</IssueDate>
        <InvoiceCurrencyCode>${esc(currency)}</InvoiceCurrencyCode>
        <TaxCurrencyCode>${esc(currency)}</TaxCurrencyCode>
        <LanguageName>es</LanguageName>
      </InvoiceIssueData>
      <TaxesOutputs>
          ${taxesOutputs}
      </TaxesOutputs>
      <InvoiceTotals>
        <TotalGrossAmount>${dec(grossBeforeTaxes)}</TotalGrossAmount>
        <TotalGeneralDiscounts>0.00</TotalGeneralDiscounts>
        <TotalGeneralSurcharges>0.00</TotalGeneralSurcharges>
        <TotalGrossAmountBeforeTaxes>${dec(grossBeforeTaxes)}</TotalGrossAmountBeforeTaxes>
        <TotalTaxOutputs>${dec(totals.taxCents)}</TotalTaxOutputs>
        <TotalTaxesWithheld>0.00</TotalTaxesWithheld>
        <InvoiceTotal>${dec(totals.totalCents)}</InvoiceTotal>
        <TotalOutstandingAmount>${dec(totals.totalCents)}</TotalOutstandingAmount>
        <TotalExecutableAmount>${dec(totals.totalCents)}</TotalExecutableAmount>
      </InvoiceTotals>
      <Items>
          ${items}
      </Items>
    </Invoice>
  </Invoices>
</fe:Facturae>`;
}
