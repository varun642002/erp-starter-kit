import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as QRCode from 'qrcode';
import type { CompanySettings } from '../../types/erp';
import type { DocumentDetail, DocumentItem } from '../../services/documentApi';
import type { CompanyProfile } from '../../services/companyApi';
import { useCompanies } from '../../hooks/useCompanies';
import { amountInWordsINR } from '../../utils/amountInWords';
import {
  formatDateShort,
  formatDateTimeShort,
  inr,
  round2,
  stateCodeFromName
} from './calc';

// The printed document is always black on white, laid out like a Tally GST tax invoice.
const BORDER = '1px solid #000';
const LIGHT = '1px solid #9a9a9a';

const ROOT: React.CSSProperties = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '9pt',
  lineHeight: 1.25,
  color: '#000',
  background: '#fff',
  boxSizing: 'border-box'
};

const fmtQty = (q: number) => String(Number(q.toFixed(3)));
const dt = (iso: string | null | undefined) => (iso ? `dt. ${formatDateShort(iso)}` : '');
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join('  ');

interface SheetProps {
  doc: DocumentDetail;
  // Only the currency symbol is read from here; the seller block comes from the document's company profile.
  settings: CompanySettings;
  branchName?: string;
  // Preview only: draws each page as a sheet of paper with the print margin.
  paper?: boolean;
}

type PageProps = SheetProps & { company: CompanyProfile };

const QrSvg: React.FC<{ text: string; size: string }> = ({ text, size }) => {
  const qr = useMemo(() => {
    try {
      const code = QRCode.create(text, { errorCorrectionLevel: 'L' });
      const n = code.modules.size;
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) if (code.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
      return { n, d };
    } catch {
      return null;
    }
  }, [text]);
  if (!qr) return <div style={{ width: size, fontSize: '7pt' }}>QR text is too long to encode</div>;
  return (
    <svg viewBox={`-1 -1 ${qr.n + 2} ${qr.n + 2}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label="QR code" style={{ display: 'block' }}>
      <rect x={-1} y={-1} width={qr.n + 2} height={qr.n + 2} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
};

const LabelValue: React.FC<{ label: string; value?: string | null; labelWidth?: string; bold?: boolean }> = ({ label, value, labelWidth = '22mm', bold = true }) => (
  <div style={{ display: 'flex' }}>
    <span style={{ width: labelWidth, flexShrink: 0 }}>{label}</span>
    <span style={{ fontWeight: bold ? 700 : 400, wordBreak: 'break-all' }}>: {value}</span>
  </div>
);

const PartyBlock: React.FC<{
  heading: string;
  name: string;
  address?: string | null;
  gstin?: string | null;
  stateName?: string | null;
  stateCode?: string | null;
  // Invoice-only documents carry no GST detail, so the GSTIN and state rows are left out unless a GSTIN was entered.
  gstDetails?: boolean;
}> = ({ heading, name, address, gstin, stateName, stateCode, gstDetails = true }) => (
  <div style={{ padding: '1mm 2mm 1.5mm', borderTop: LIGHT }}>
    <div>{heading}</div>
    <div style={{ fontWeight: 700, fontSize: '10pt', marginTop: '0.5mm' }}>{name}</div>
    {address && <div style={{ fontSize: '7.5pt', lineHeight: 1.1, whiteSpace: 'pre-line', margin: '0.5mm 0' }}>{address}</div>}
    {(gstDetails || gstin) && <LabelValue label="GSTIN/UIN" value={gstin || 'Unregistered'} bold={false} />}
    {gstDetails && <LabelValue label="State Name" value={stateName ? `${stateName}${stateCode ? `, Code : ${stateCode}` : ''}` : ''} bold={false} />}
  </div>
);

// One cell of the right-hand reference grid: small label, bold value underneath.
const RefCell: React.FC<{ label: string; value?: string | null; right?: boolean; span?: boolean; children?: React.ReactNode }> = ({ label, value, right, span, children }) => (
  <div
    style={{
      minHeight: '8.3mm',
      padding: '0.5mm 1.5mm',
      borderBottom: LIGHT,
      borderLeft: right ? LIGHT : undefined,
      gridColumn: span ? '1 / span 2' : undefined,
      boxSizing: 'border-box'
    }}
  >
    {children ?? (
      <>
        <div>{label}</div>
        <div style={{ fontWeight: 700 }}>{value}</div>
      </>
    )}
  </div>
);

interface HsnRow {
  hsn: string;
  rate: number;
  taxable: number;
  tax: number;
}

function hsnSummary(items: DocumentItem[]): HsnRow[] {
  const map = new Map<string, HsnRow>();
  for (const it of items) {
    const key = `${it.hsnCode || ''}|${it.gstRate}`;
    const row = map.get(key) || { hsn: it.hsnCode || '', rate: it.gstRate, taxable: 0, tax: 0 };
    row.taxable = round2(row.taxable + it.taxableValue);
    row.tax = round2(row.tax + it.taxAmount);
    map.set(key, row);
  }
  return [...map.values()];
}

const companyName = (c: CompanyProfile) => c.legalName || c.displayName;

// ---------- page 1: tax invoice / quotation ----------

const InvoicePage: React.FC<PageProps> = ({ doc, settings, company }) => {
  const isInvoice = doc.docType === 'invoice';
  // "Invoice only": no GST columns, tax summary, e-invoice or e-way bill.
  const isPlain = doc.invoiceKind === 'plain';
  const showEinvoice = isInvoice && !isPlain && !!doc.irn;
  const currency = settings.currencySymbol || '₹';
  const name = companyName(company);
  const docTitle = isInvoice ? (isPlain ? 'INVOICE' : 'TAX INVOICE') : 'QUOTATION';
  const hsnRows = useMemo(() => hsnSummary(doc.items), [doc.items]);
  const totalTax = round2(doc.cgst + doc.sgst + doc.igst);
  const totalQty = doc.items.reduce((a, i) => a + i.quantity, 0);
  const units = new Set(doc.items.map((i) => i.unit || ''));
  const totalQtyText = units.size === 1 && [...units][0] ? `${fmtQty(totalQty)} ${[...units][0]}` : fmtQty(totalQty);

  const consigneeName = doc.consigneeName || doc.customerName;
  const consigneeAddress = doc.consigneeName || doc.consigneeAddress ? doc.consigneeAddress : doc.shippingAddress || doc.billingAddress;
  const consigneeGstin = doc.consigneeName || doc.consigneeGstin ? doc.consigneeGstin : doc.customerGstin;
  const sameConsignee = !doc.consigneeName && !doc.consigneeAddress && !doc.consigneeGstin;
  const consigneeStateName = sameConsignee ? doc.buyerStateName || doc.placeOfSupply : doc.consigneeStateName;
  const consigneeStateCode = sameConsignee ? doc.buyerStateCode || stateCodeFromName(doc.placeOfSupply) : doc.consigneeStateCode;
  const buyerStateName = doc.buyerStateName || doc.placeOfSupply;
  const buyerStateCode = doc.buyerStateCode || stateCodeFromName(buyerStateName);

  const cols = isPlain ? ['4%', '46%', '15%', '14%', '6%', '15%'] : ['2.3%', '36.7%', '10.2%', '10.3%', '10.4%', '10.5%', '4.1%', '15.5%'];
  const colCount = cols.length;
  const cell = (align: 'left' | 'right' | 'center' = 'left', extra: React.CSSProperties = {}): React.CSSProperties => ({
    borderLeft: BORDER,
    borderRight: BORDER,
    padding: '0.8mm 1.2mm',
    verticalAlign: 'top',
    textAlign: align,
    ...extra
  });
  const emptyCells = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} style={cell()} />);
  const spacer = (mm: number, key: string) => (
    <tr key={key} style={{ height: `${mm}mm` }}>
      {emptyCells(colCount)}
    </tr>
  );
  // Empty row under the items that soaks up all the spare height of the page (never shorter than a few millimetres).
  const fillerRow = (key: string) => (
    <tr key={key} style={{ height: '100%' }}>
      {Array.from({ length: colCount }, (_, i) => (
        <td key={i} style={cell('left', { minHeight: `${bodyHeight}mm`, height: '100%' })} />
      ))}
    </tr>
  );
  const taxRow = (label: string, amount: number, key: string, signed = false) => (
    <tr key={key}>
      <td style={cell()} />
      <td style={cell('right', { fontStyle: 'italic', fontWeight: 700 })}>{label}</td>
      {emptyCells(colCount - 3)}
      <td style={cell('right', { fontWeight: 700 })}>{signed && amount < 0 ? `(-)${inr(Math.abs(amount))}` : inr(amount)}</td>
    </tr>
  );

  const hasBank = [company.bankName, company.accountNumber, company.ifscCode, company.bankBranch, company.upiId].some((v) => v.trim());
  const sellerState = company.stateName ? `${company.stateName}${company.stateCode ? `, Code : ${company.stateCode}` : ''}` : '';
  const bodyHeight = Math.max(3, 15 - doc.items.length * 10);

  return (
    // The page fills the whole A4 sheet: the list of items stretches so the totals, tax summary and signature sit at
    // the bottom of the page however few items there are. (A4 is 297mm; the 8mm print margin is taken off both ends.)
    <div style={{ ...ROOT, display: 'flex', flexDirection: 'column', minHeight: '280mm' }}>
      <div style={{ position: 'relative', textAlign: 'center', fontWeight: 700, fontSize: '12pt', padding: '1.5mm 0 2mm' }}>
        {docTitle}
        {(doc.storedStatus === 'Draft' || doc.status === 'Cancelled' || doc.status === 'Expired') && (
          <span style={{ position: 'absolute', left: 0, top: '2mm', fontSize: '8pt', fontWeight: 700 }}>
            {doc.status === 'Cancelled' ? 'CANCELLED' : doc.status === 'Expired' ? 'EXPIRED' : 'DRAFT'}
          </span>
        )}
        {showEinvoice && <span style={{ position: 'absolute', right: '8mm', top: '1mm', fontSize: '9pt' }}>e-Invoice</span>}
      </div>

      {showEinvoice && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '32mm', marginBottom: '2mm' }}>
          <div style={{ paddingTop: '12mm', maxWidth: '125mm' }}>
            <LabelValue label="IRN" value={doc.irn} />
            <LabelValue label="Ack No." value={doc.ackNo} />
            <LabelValue label="Ack Date" value={formatDateShort(doc.ackDate)} />
          </div>
          {doc.einvoiceQr && (
            <div style={{ marginRight: '4mm', marginTop: '2mm' }}>
              <QrSvg text={doc.einvoiceQr} size="33mm" />
            </div>
          )}
        </div>
      )}

      <div style={{ border: BORDER, display: 'grid', gridTemplateColumns: '55.3% 44.7%' }}>
        <div>
          <div style={{ padding: '1mm 2mm 1.5mm' }}>
            <div style={{ fontWeight: 700, fontSize: '10pt' }}>{name}</div>
            {company.tagline && <div style={{ fontSize: '7.5pt' }}>{company.tagline}</div>}
            {company.addressLines && <div style={{ whiteSpace: 'pre-line' }}>{company.addressLines}</div>}
            {company.phone && <div>Phone : {company.phone}</div>}
            {company.gstin && <div>GSTIN/UIN: {company.gstin}</div>}
            {sellerState && <div>State Name : {sellerState}</div>}
            {company.email && <div>E-Mail : {company.email}</div>}
            {company.website && <div>Website : {company.website}</div>}
          </div>
          <PartyBlock
            heading="Consignee (Ship to)"
            name={consigneeName}
            address={consigneeAddress}
            gstin={consigneeGstin}
            stateName={consigneeStateName}
            stateCode={consigneeStateCode}
            gstDetails={!isPlain}
          />
          <PartyBlock
            heading="Buyer (Bill to)"
            name={doc.customerName}
            address={doc.billingAddress}
            gstin={doc.customerGstin}
            stateName={buyerStateName}
            stateCode={buyerStateCode}
            gstDetails={!isPlain}
          />
        </div>

        <div style={{ borderLeft: BORDER, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: isInvoice ? 'repeat(7, auto) 1fr' : 'repeat(3, auto) 1fr' }}>
          <RefCell label="">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm' }}>
              <div>
                <div>{isInvoice ? 'Invoice No.' : 'Quotation No.'}</div>
                <div style={{ fontWeight: 700, fontSize: '7.5pt' }}>{doc.docNumber}</div>
              </div>
              {isInvoice && !isPlain && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '7.5pt' }}>e-Way Bill No.</div>
                  <div style={{ fontWeight: 700, fontSize: '7.5pt' }}>{doc.ewayBillNo}</div>
                </div>
              )}
            </div>
          </RefCell>
          <RefCell right label="Dated" value={formatDateShort(doc.docDate)} />

          {isInvoice ? (
            <>
              <RefCell label="Delivery Note" value={doc.deliveryNote} />
              <RefCell right label="Mode/Terms of Payment" value={doc.paymentTerms} />
            </>
          ) : (
            <>
              <RefCell label="Valid Until" value={formatDateShort(doc.validUntil)} />
              <RefCell right label="Mode/Terms of Payment" value={doc.paymentTerms} />
            </>
          )}

          <RefCell label="Reference No. & Date." value={join(doc.referenceNo, dt(doc.referenceDate))} />
          <RefCell right label="Other References" value={doc.otherReferences} />

          {isInvoice && (
            <>
              <RefCell label="Buyer's Order No." value={doc.buyerOrderNo} />
              <RefCell right label="Dated" value={formatDateShort(doc.buyerOrderDate)} />
              <RefCell label="Dispatch Doc No." value={doc.dispatchDocNo} />
              <RefCell right label="Delivery Note Date" value={formatDateShort(doc.deliveryNoteDate)} />
              <RefCell label="Dispatched through" value={doc.dispatchedThrough} />
              <RefCell right label="Destination" value={doc.destination} />
              <RefCell label="Bill of Lading/LR-RR No." value={join(doc.ladingNo, dt(doc.ladingDate))} />
              <RefCell right label="Motor Vehicle No." value={doc.vehicleNo} />
            </>
          )}
          <RefCell span label="Terms of Delivery" value={doc.termsOfDelivery} />
        </div>
      </div>

      <div style={{ flex: '1 1 auto', display: 'flex' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: '2px solid #000', borderBottom: BORDER }}>
        <colgroup>
          {cols.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ borderBottom: BORDER }}>
            <th style={cell('left', { fontWeight: 400, verticalAlign: 'middle' })}>Sl No.</th>
            <th style={cell('center', { fontWeight: 400, verticalAlign: 'middle' })}>Description of Goods</th>
            {!isPlain && <th style={cell('left', { fontWeight: 400, verticalAlign: 'middle' })}>HSN/SAC</th>}
            <th style={cell('left', { fontWeight: 400, verticalAlign: 'middle' })}>Quantity</th>
            {!isPlain && (
              <th style={cell('center', { fontWeight: 400 })}>
                Rate
                <br />
                (Incl. of Tax)
              </th>
            )}
            <th style={cell('center', { fontWeight: 400, verticalAlign: 'middle' })}>Rate</th>
            <th style={cell('center', { fontWeight: 400, verticalAlign: 'middle' })}>per</th>
            <th style={cell('center', { fontWeight: 400, verticalAlign: 'middle' })}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => {
            const factor = 1 + it.gstRate / 100;
            const baseRate = doc.pricesIncludeTax ? round2(it.rate / factor) : it.rate;
            const inclusiveRate = doc.pricesIncludeTax ? it.rate : round2(it.rate * factor);
            const qtyText = `${fmtQty(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`;
            return (
              <tr key={it.id}>
                <td style={cell()}>{i + 1}</td>
                <td style={cell('left', { fontWeight: 700, fontSize: '10pt' })}>
                  {it.description}
                  {it.batchNote && (
                    <div style={{ fontStyle: 'italic', fontSize: '9pt', marginTop: '1mm' }}>
                      Batch : <b>{it.batchNote}</b>
                    </div>
                  )}
                  {it.discountPercent > 0 && <div style={{ fontStyle: 'italic', fontWeight: 400, fontSize: '8pt' }}>Less : {it.discountPercent}% discount</div>}
                </td>
                {!isPlain && <td style={cell()}>{it.hsnCode}</td>}
                <td style={cell('right')}>
                  <b>{qtyText}</b>
                  {it.batchNote && <div style={{ marginTop: '1mm' }}>{qtyText}</div>}
                </td>
                {!isPlain && <td style={cell('right')}>{inr(inclusiveRate)}</td>}
                <td style={cell('right')}>{inr(baseRate)}</td>
                <td style={cell('center')}>{it.unit}</td>
                <td style={cell('right', { fontWeight: 700 })}>{inr(it.taxableValue)}</td>
              </tr>
            );
          })}
          {fillerRow('sp1')}
          {!isPlain && (doc.isInterState ? taxRow('IGST', doc.igst, 'igst') : [taxRow('CGST', doc.cgst, 'cgst'), taxRow('SGST', doc.sgst, 'sgst')])}
          {doc.otherCharges > 0 && taxRow('Other Charges', doc.otherCharges, 'other')}
          {doc.roundOff !== 0 && taxRow('Round Off', doc.roundOff, 'round', true)}
          {spacer(4, 'sp2')}
          <tr style={{ borderTop: BORDER }}>
            <td style={cell()} />
            <td style={cell('right')}>Total</td>
            {!isPlain && <td style={cell()} />}
            <td style={cell('right', { fontWeight: 700 })}>{totalQtyText}</td>
            {emptyCells(isPlain ? 2 : 3)}
            <td style={cell('right', { fontWeight: 700, fontSize: '11pt' })}>
              {currency} {inr(doc.grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <div style={{ borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER, padding: '0.8mm 2mm 1.2mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '8pt' }}>Amount Chargeable (in words)</span>
          <span style={{ fontStyle: 'italic' }}>E. &amp; O.E</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: '10pt', marginTop: '1mm' }}>{amountInWordsINR(doc.grandTotal)}</div>
      </div>

      {!isPlain && (
        <>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER }}>
          <colgroup>
            {(doc.isInterState ? ['39%', '13%', '10%', '19%', '19%'] : ['39%', '11.5%', '8%', '10.5%', '8%', '10.5%', '12.5%']).map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} style={{ fontWeight: 400, textAlign: 'center', border: LIGHT }}>
                HSN/SAC
              </th>
              <th rowSpan={2} style={{ fontWeight: 400, border: LIGHT }}>
                Taxable
                <br />
                Value
              </th>
              {doc.isInterState ? (
                <th colSpan={2} style={{ fontWeight: 400, border: LIGHT }}>
                  Integrated Tax
                </th>
              ) : (
                <>
                  <th colSpan={2} style={{ fontWeight: 400, border: LIGHT }}>
                    Central Tax
                  </th>
                  <th colSpan={2} style={{ fontWeight: 400, border: LIGHT }}>
                    State Tax
                  </th>
                </>
              )}
              <th rowSpan={2} style={{ fontWeight: 400, border: LIGHT }}>
                Total
                <br />
                Tax Amount
              </th>
            </tr>
            <tr>
              {(doc.isInterState ? [0] : [0, 1]).map((k) => (
                <React.Fragment key={k}>
                  <th style={{ fontWeight: 400, border: LIGHT }}>Rate</th>
                  <th style={{ fontWeight: 400, border: LIGHT }}>Amount</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {hsnRows.map((r) => (
              <tr key={`${r.hsn}-${r.rate}`}>
                <td style={{ padding: '0 1.5mm', borderBottom: LIGHT }}>{r.hsn}</td>
                <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{inr(r.taxable)}</td>
                {doc.isInterState ? (
                  <>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{r.rate.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{inr(r.tax)}</td>
                  </>
                ) : (
                  <>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{(r.rate / 2).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{inr(round2(r.tax / 2))}</td>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{(r.rate / 2).toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{inr(round2(r.tax / 2))}</td>
                  </>
                )}
                <td style={{ textAlign: 'right', padding: '0 1.5mm', borderBottom: LIGHT }}>{inr(r.tax)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>Total</td>
              <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>{inr(doc.taxableAmount)}</td>
              {doc.isInterState ? (
                <>
                  <td />
                  <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>{inr(doc.igst)}</td>
                </>
              ) : (
                <>
                  <td />
                  <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>{inr(doc.cgst)}</td>
                  <td />
                  <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>{inr(doc.sgst)}</td>
                </>
              )}
              <td style={{ textAlign: 'right', padding: '0 1.5mm' }}>{inr(totalTax)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER, padding: '1.2mm 2mm' }}>
          <span style={{ fontSize: '8pt' }}>Tax Amount (in words) : </span>
          <b style={{ fontSize: '10pt' }}>{amountInWordsINR(totalTax)}</b>
        </div>
        </>
      )}

      {(doc.terms || doc.notes) && (
        <div style={{ borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER, padding: '1mm 2mm', fontSize: '8pt' }}>
          {doc.terms && (
            <div style={{ marginBottom: doc.notes ? '1mm' : 0 }}>
              <b>{isInvoice ? 'Terms' : 'Terms & Conditions'}</b>
              <div style={{ whiteSpace: 'pre-line' }}>{doc.terms}</div>
            </div>
          )}
          {doc.notes && (
            <div>
              <b>Notes</b>
              <div style={{ whiteSpace: 'pre-line' }}>{doc.notes}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ border: BORDER, borderTop: 'none', display: 'grid', gridTemplateColumns: '50% 50%' }}>
        <div style={{ padding: '1mm 2mm', display: 'flex', alignItems: 'flex-end', minHeight: '14mm', boxSizing: 'border-box' }}>
          {company.pan && (
            <div style={{ display: 'flex', gap: '12mm' }}>
              <span>Company's PAN</span>
              <span>
                : <b>{company.pan}</b>
              </span>
            </div>
          )}
        </div>
        <div style={{ borderLeft: LIGHT, padding: '1mm 2mm', fontSize: '8.5pt' }}>
          {hasBank && (
            <>
              <div style={{ fontSize: '9pt' }}>Company's Bank Details</div>
              <LabelValue label="A/c Holder's Name" value={name} labelWidth="30mm" />
              {company.bankName && <LabelValue label="Bank Name" value={company.bankName} labelWidth="30mm" />}
              {company.accountNumber && <LabelValue label="A/c No." value={company.accountNumber} labelWidth="30mm" />}
              {(company.bankBranch || company.ifscCode) && (
                <LabelValue label="Branch & IFS Code" value={[company.bankBranch, company.ifscCode].filter(Boolean).join(' & ')} labelWidth="30mm" />
              )}
              {company.upiId && <LabelValue label="UPI ID" value={company.upiId} labelWidth="30mm" />}
            </>
          )}
        </div>
        <div style={{ borderTop: LIGHT, padding: '1mm 2mm', minHeight: '13mm' }}>
          <div style={{ fontSize: '7pt', textDecoration: 'underline' }}>Declaration</div>
          <div>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</div>
        </div>
        <div style={{ borderTop: LIGHT, borderLeft: LIGHT, padding: '1mm 2mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '13mm' }}>
          <div style={{ textAlign: 'right', fontWeight: 700 }}>for {name}</div>
          <div style={{ textAlign: 'right' }}>{company.signatoryLabel || 'Authorised Signatory'}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '3mm' }}>This is a Computer Generated {isInvoice ? 'Invoice' : 'Quotation'}</div>
    </div>
  );
};

// ---------- page 2: e-Way Bill ----------

const EwayBillPage: React.FC<PageProps> = ({ doc, company }) => {
  const name = companyName(company);
  const buyerState = doc.buyerStateName || doc.placeOfSupply;
  const sameConsignee = !doc.consigneeName && !doc.consigneeAddress && !doc.consigneeGstin;
  const shipAddress = sameConsignee ? doc.shippingAddress || doc.billingAddress : doc.consigneeAddress;
  const shipState = sameConsignee ? buyerState : doc.consigneeStateName;
  const flat = (s: string | null | undefined) => (s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(', ');
  const qrText = `${doc.ewayBillNo}/${company.gstin}/${(doc.ewbGeneratedAt || doc.docDate).slice(0, 10)}`;
  const section: React.CSSProperties = { borderTop: LIGHT, padding: '2.5mm 0' };
  const heading: React.CSSProperties = { fontWeight: 700, marginBottom: '2mm' };

  const rate = (r: number) => (doc.isInterState ? r.toFixed(2) : `${(r / 2).toFixed(2)}+${(r / 2).toFixed(2)}`);
  const otherAmt = round2(doc.otherCharges + doc.roundOff);

  return (
    <div style={ROOT}>
      <div style={{ position: 'relative', textAlign: 'center', fontWeight: 700, fontSize: '12pt', padding: '1.5mm 0 2mm' }}>
        <span style={{ borderBottom: LIGHT, padding: '0 8mm' }}>e-Way Bill</span>
        <span style={{ position: 'absolute', right: '10mm', top: '1mm', fontSize: '9pt' }}>e-Way Bill</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: '38mm', paddingTop: '4mm' }}>
        <div>
          <LabelValue label="Doc No." value={`Tax Invoice - ${doc.docNumber}`} labelWidth="18mm" />
          <LabelValue label="Date" value={formatDateShort(doc.docDate)} labelWidth="18mm" />
          {doc.irn && (
            <div style={{ marginTop: '4mm' }}>
              <LabelValue label="IRN" value={doc.irn} labelWidth="18mm" />
              <LabelValue label="Ack No." value={doc.ackNo} labelWidth="18mm" />
              <LabelValue label="Ack Date" value={formatDateShort(doc.ackDate)} labelWidth="18mm" />
            </div>
          )}
        </div>
        <div style={{ marginRight: '4mm' }}>
          <QrSvg text={qrText} size="30mm" />
        </div>
      </div>

      <div style={section}>
        <div style={heading}>1. e-Way Bill Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: '1mm 4mm' }}>
          <div>
            <LabelValue label="e-Way Bill No." value={doc.ewayBillNo} labelWidth="26mm" />
            {company.gstin && <LabelValue label="Generated By" value={company.gstin} labelWidth="26mm" />}
            <LabelValue label="Supply Type" value={doc.ewbSupplyType} labelWidth="26mm" />
          </div>
          <div>
            <LabelValue label="Mode" value={doc.ewbMode} labelWidth="30mm" />
            <LabelValue label="Approx Distance" value={doc.ewbDistanceKm != null ? `${doc.ewbDistanceKm} KM` : ''} labelWidth="30mm" />
            <LabelValue label="Transaction Type" value={doc.ewbTransactionType} labelWidth="30mm" />
          </div>
          <div>
            <LabelValue label="Generated Date" value={formatDateTimeShort(doc.ewbGeneratedAt)} labelWidth="28mm" />
            <LabelValue label="Valid Upto" value={formatDateTimeShort(doc.ewbValidUpto)} labelWidth="28mm" />
          </div>
        </div>
      </div>

      <div style={section}>
        <div style={heading}>2. Address Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3mm 6mm' }}>
          <div>
            <div style={{ ...heading, marginBottom: '1.5mm' }}>From</div>
            <div>{name}</div>
            {company.gstin && <div style={{ marginTop: '1.5mm' }}>GSTIN : {company.gstin}</div>}
            {company.stateName && <div style={{ marginTop: '1.5mm' }}>{company.stateName}</div>}
          </div>
          <div>
            <div style={{ ...heading, marginBottom: '1.5mm' }}>To</div>
            <div>{doc.customerName}</div>
            <div style={{ marginTop: '1.5mm' }}>GSTIN : {doc.customerGstin || 'URP'}</div>
            <div style={{ marginTop: '1.5mm' }}>{buyerState}</div>
          </div>
          <div>
            <div style={{ ...heading, marginBottom: '1.5mm' }}>Dispatch From</div>
            <div>{flat(company.addressLines)}</div>
            <div>{[doc.ewbFromPlace, company.stateName].filter(Boolean).join(' ')}</div>
          </div>
          <div>
            <div style={{ ...heading, marginBottom: '1.5mm' }}>Ship To</div>
            <div>{flat(shipAddress)}</div>
            <div>{[doc.destination, shipState].filter(Boolean).join(' ')}</div>
          </div>
        </div>
      </div>

      <div style={section}>
        <div style={heading}>3. Goods Details</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: LIGHT, borderBottom: LIGHT }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '1mm 2mm 1mm 0', width: '20mm' }}>HSN Code</th>
              <th style={{ padding: '1mm 0' }}>Product Name &amp; Desc</th>
              <th style={{ padding: '1mm 2mm', textAlign: 'right' }}>Quantity</th>
              <th style={{ padding: '1mm 2mm', textAlign: 'right' }}>Taxable Amt</th>
              <th style={{ padding: '1mm 0 1mm 2mm', textAlign: 'right' }}>Tax Rate ({doc.isInterState ? 'I' : 'C+S'})</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it) => (
              <tr key={it.id} style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '1.5mm 2mm 1.5mm 0', fontWeight: 700 }}>{it.hsnCode}</td>
                <td style={{ padding: '1.5mm 0' }}>{it.description}</td>
                <td style={{ padding: '1.5mm 2mm', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmtQty(it.quantity)} {(it.unit || '').toUpperCase()}
                </td>
                <td style={{ padding: '1.5mm 2mm', textAlign: 'right', fontWeight: 700 }}>{inr(it.taxableValue)}</td>
                <td style={{ padding: '1.5mm 0 1.5mm 2mm', textAlign: 'right', whiteSpace: 'nowrap' }}>{rate(it.gstRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1mm 4mm', marginTop: '8mm' }}>
          <LabelValue label="Tot.Taxable Amt" value={inr(doc.taxableAmount)} labelWidth="30mm" />
          <LabelValue label="Other Amt" value={inr(otherAmt)} labelWidth="22mm" />
          <LabelValue label="Total Inv Amt" value={inr(doc.grandTotal)} labelWidth="26mm" />
          {doc.isInterState ? (
            <LabelValue label="IGST Amt" value={inr(doc.igst)} labelWidth="30mm" />
          ) : (
            <>
              <LabelValue label="CGST Amt" value={inr(doc.cgst)} labelWidth="30mm" />
              <LabelValue label="SGST Amt" value={inr(doc.sgst)} labelWidth="22mm" />
            </>
          )}
        </div>
      </div>

      <div style={section}>
        <div style={heading}>4. Transportation Details</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <LabelValue label="Transporter ID" value={doc.transporterId} labelWidth="26mm" />
            <LabelValue label="Name" value={doc.transporterName} labelWidth="26mm" />
          </div>
          <div style={{ width: '60mm' }}>
            <LabelValue label="Doc No." value={doc.transporterDocNo} labelWidth="22mm" />
            <LabelValue label="Date" value={formatDateShort(doc.transporterDocDate)} labelWidth="22mm" />
          </div>
        </div>
      </div>

      <div style={section}>
        <div style={heading}>5. Vehicle Details</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <LabelValue label="Vehicle No." value={doc.vehicleNo} labelWidth="26mm" />
          <LabelValue label="From" value={doc.ewbFromPlace} labelWidth="14mm" />
          <div style={{ width: '60mm' }}>
            <span>CEWB No. :</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- composition ----------

const paperStyle: React.CSSProperties = {
  width: '210mm',
  minHeight: '297mm',
  padding: '8mm',
  boxSizing: 'border-box',
  background: '#fff',
  boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
  marginBottom: '6mm'
};

export const DocumentSheet: React.FC<SheetProps> = (props) => {
  const { doc, paper } = props;
  const { getCompany } = useCompanies();
  const company = getCompany(doc.companyId);
  const hasEway = doc.docType === 'invoice' && doc.invoiceKind !== 'plain' && !!doc.ewayBillNo;
  return (
    <>
      <section style={paper ? paperStyle : undefined}>
        <InvoicePage {...props} company={company} />
      </section>
      {hasEway && (
        <section style={paper ? paperStyle : { breakBefore: 'page' }}>
          <EwayBillPage {...props} company={company} />
        </section>
      )}
    </>
  );
};

export const DocumentPrintPortal: React.FC<SheetProps> = (props) =>
  createPortal(
    <div id="document-print-root" className="hidden print-only" style={{ background: '#fff', color: '#000' }}>
      <style>{`@page { size: A4; margin: 8mm; } @media print { body > *:not(#document-print-root) { display: none !important; } }`}</style>
      <DocumentSheet {...props} paper={false} />
    </div>,
    document.body
  );
