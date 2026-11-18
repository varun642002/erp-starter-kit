import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MessageCircle, Printer, Send } from 'lucide-react';
import { useERP } from '../../context/ERPContext';
import { BTN_GHOST, BTN_PRIMARY, Modal, useApiScope } from '../documents/ui';
import { useCompanies } from '../../hooks/useCompanies';
import type { CompanyProfile } from '../../services/companyApi';
import {
  buildWhatsAppLink,
  formatMessageAmount,
  formatMessageDate,
  normalizeIndianPhone,
  type MessageLanguage
} from '../../utils/whatsapp';
import { addMonthsIso, formatMoney, machineSaleApi, type MachineSale } from '../../services/machineSaleApi';

// ---------- WhatsApp update ----------

export function machineSaleMessage(ctx: {
  sale: MachineSale;
  company: string;
  currencySymbol: string;
  language: MessageLanguage;
}): string {
  const { sale, company, currencySymbol: cs, language } = ctx;
  const ta = language === 'ta';
  const machine = [sale.machineName, sale.model].filter(Boolean).join(' ') || (ta ? 'இயந்திரம்' : 'machine');
  const name = sale.customerName;
  const no = sale.saleNumber;
  const price = formatMessageAmount(sale.salePrice, cs);
  const paid = formatMessageAmount(sale.paidAmount, cs);
  const balance = formatMessageAmount(Math.max(0, sale.balance), cs);
  const expected = sale.expectedDeliveryDate ? formatMessageDate(sale.expectedDeliveryDate) : '';
  const hi = ta ? `வணக்கம் ${name},` : `Dear ${name},`;
  const bye = ta ? `நன்றி,\n${company}` : `Thank you,\n${company}`;

  let body: string;
  switch (sale.status) {
    case 'Booked':
      body = ta
        ? `${company}-இல் ${machine} முன்பதிவு செய்ததற்கு நன்றி. முன்பதிவு எண்: ${no}.\n\nவிலை: ${price}\nசெலுத்திய தொகை: ${paid}\nநிலுவைத் தொகை: ${balance}${expected ? `\nடெலிவரி தேதி: ${expected}` : ''}`
        : `Thank you for booking your ${machine} with ${company}. Booking no. ${no}.\n\nPrice: ${price}\nPaid so far: ${paid}\nBalance: ${balance}${expected ? `\nExpected delivery: ${expected}` : ''}`;
      break;
    case 'Ready for Delivery':
      body = ta
        ? `உங்கள் ${machine} (முன்பதிவு எண் ${no}) டெலிவரிக்குத் தயாராக உள்ளது.${sale.balance > 0 ? ` நிலுவைத் தொகை: ${balance}.` : ''}${expected ? `\nடெலிவரி தேதி: ${expected}` : ''}`
        : `Your ${machine} (booking no. ${no}) is ready for delivery.${sale.balance > 0 ? ` Balance due: ${balance}.` : ''}${expected ? `\nExpected delivery: ${expected}` : ''}`;
      break;
    case 'Dispatched': {
      const driver = [sale.driverName, sale.driverPhone].filter(Boolean).join(' ');
      body = ta
        ? `உங்கள் ${machine} (${no}) அனுப்பப்பட்டுள்ளது.${sale.vehicleNo ? `\nவாகன எண்: ${sale.vehicleNo}` : ''}${driver ? `\nஓட்டுநர்: ${driver}` : ''}${sale.balance > 0 ? `\nடெலிவரியின் போது செலுத்த வேண்டிய தொகை: ${balance}` : ''}`
        : `Your ${machine} (${no}) has been dispatched.${sale.vehicleNo ? `\nVehicle: ${sale.vehicleNo}` : ''}${driver ? `\nDriver: ${driver}` : ''}${sale.balance > 0 ? `\nBalance due on delivery: ${balance}` : ''}`;
      break;
    }
    case 'Delivered': {
      const start = sale.warrantyStart || sale.deliveredDate || '';
      const end = sale.warrantyMonths > 0 && start ? addMonthsIso(start, sale.warrantyMonths) : '';
      const date = formatMessageDate(sale.deliveredDate);
      body = ta
        ? `உங்கள் ${machine}${sale.serialNumber ? ` (வரிசை எண்: ${sale.serialNumber})` : ''} ${date} அன்று டெலிவரி செய்யப்பட்டது.${end ? `\nஉத்தரவாதம்: ${sale.warrantyMonths} மாதங்கள் (${formatMessageDate(end)} வரை)` : ''}${sale.balance > 0 ? `\nநிலுவைத் தொகை: ${balance}` : ''}\n\n${company}-ஐத் தேர்ந்தெடுத்ததற்கு நன்றி.`
        : `Your ${machine}${sale.serialNumber ? ` (serial no. ${sale.serialNumber})` : ''} was delivered on ${date}.${end ? `\nWarranty: ${sale.warrantyMonths} months, valid until ${formatMessageDate(end)}` : ''}${sale.balance > 0 ? `\nBalance due: ${balance}` : ''}\n\nThank you for choosing ${company}.`;
      break;
    }
    default:
      body = ta ? `முன்பதிவு ${no} (${machine}) ரத்து செய்யப்பட்டது.` : `Booking ${no} for ${machine} has been cancelled.`;
  }
  return `${hi}\n\n${body}\n\n${bye}`;
}

export const SaleWhatsAppButton: React.FC<{ sale: MachineSale; className?: string }> = ({ sale, className = '' }) => {
  const { settings } = useERP();
  const { getCompany } = useCompanies();
  const [language, setLanguage] = useState<MessageLanguage>('en');
  const hasPhone = !!normalizeIndianPhone(sale.customerPhone);

  const send = () => {
    const text = machineSaleMessage({
      sale,
      company: getCompany(sale.companyId).displayName,
      currencySymbol: settings.currencySymbol || '₹',
      language
    });
    const link = buildWhatsAppLink(sale.customerPhone, text);
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
  };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as MessageLanguage)}
        aria-label="Message language"
        className="rounded-lg border border-slate-300 bg-white px-1.5 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        <option value="en">English</option>
        <option value="ta">Tamil</option>
      </select>
      <button
        type="button"
        onClick={send}
        disabled={!hasPhone}
        title={hasPhone ? 'Send a status update on WhatsApp' : 'No valid mobile number on this sale'}
        className={BTN_GHOST}
      >
        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
      </button>
    </span>
  );
};

// ---------- Printable challan ----------

const Row: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) => (
  <tr>
    <td className="w-32 py-0.5 pr-2 align-top text-gray-600">{label}</td>
    <td className={`py-0.5 align-top font-semibold ${mono ? 'font-mono' : ''}`}>{value || '-'}</td>
  </tr>
);

const ChallanSheet: React.FC<{ sale: MachineSale; company: CompanyProfile; currency: string }> = ({ sale, company, currency }) => {
  const money = (n: number) => formatMoney(n, currency);
  const deliveryDate = sale.deliveredDate || sale.expectedDeliveryDate;
  const warrantyStart = sale.warrantyStart || sale.deliveredDate || '';
  const warrantyEnd = sale.warrantyMonths > 0 && warrantyStart ? addMonthsIso(warrantyStart, sale.warrantyMonths) : '';
  const delivered = sale.status === 'Delivered';

  return (
    <div className="bg-white p-8 text-[12px] leading-snug text-black">
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <h1 className="text-lg font-bold">{company.displayName}</h1>
          {company.legalName && company.legalName !== company.displayName && <p>{company.legalName}</p>}
          {company.addressLines && <p className="whitespace-pre-line">{company.addressLines}</p>}
          <p>
            {company.phone && `Phone: ${company.phone}`}
            {company.phone && company.gstin && '  |  '}
            {company.gstin && `GSTIN: ${company.gstin}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold uppercase tracking-wide">Delivery Challan</p>
          <p className="text-[11px] text-gray-600">Handover note</p>
          <p className="mt-1 font-mono text-sm font-bold">{sale.saleNumber}</p>
          {sale.documentNumber && <p>Invoice: {sale.documentNumber}</p>}
          <p>Booked: {formatMessageDate(sale.bookingDate)}</p>
          <p>{delivered ? 'Delivered' : 'Delivery'}: {formatMessageDate(deliveryDate)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-gray-500">Customer</p>
          <p className="text-sm font-bold">{sale.customerName}</p>
          <p>{sale.customerPhone || '-'}</p>
          {sale.customerAddress && <p className="whitespace-pre-line">{sale.customerAddress}</p>}
          {sale.customerGstin && <p className="font-mono">GSTIN: {sale.customerGstin}</p>}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase text-gray-500">Delivered to</p>
          <p className="whitespace-pre-line">{sale.deliveryAddress || sale.customerAddress || '-'}</p>
          <table className="mt-2">
            <tbody>
              <Row label="Vehicle no." value={sale.vehicleNo} mono />
              <Row label="Driver" value={[sale.driverName, sale.driverPhone].filter(Boolean).join(', ')} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 border border-black">
        <p className="border-b border-black bg-gray-100 px-3 py-1 text-[11px] font-bold uppercase">Machine details</p>
        <div className="grid grid-cols-2 gap-x-6 px-3 py-2">
          <table>
            <tbody>
              <Row label="Machine" value={sale.machineName} />
              <Row label="Model" value={sale.model} />
              <Row label="Item no." value={sale.sku} mono />
            </tbody>
          </table>
          <table>
            <tbody>
              <Row label="Serial no." value={sale.serialNumber} mono />
              <Row label="Engine no." value={sale.engineNumber} mono />
              <Row label="Chassis no." value={sale.chassisNumber} mono />
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div className="border border-black">
          <p className="border-b border-black bg-gray-100 px-3 py-1 text-[11px] font-bold uppercase">Price and payment</p>
          <div className="space-y-0.5 px-3 py-2">
            <div className="flex justify-between">
              <span>List price</span>
              <span>{money(sale.listPrice)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{money(sale.discount)}</span>
              </div>
            )}
            {sale.gstRate > 0 && (
              <div className="flex justify-between">
                <span>GST ({sale.gstRate}%)</span>
                <span>+{money(sale.gstAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-400 pt-0.5 font-bold">
              <span>{sale.gstRate > 0 ? 'Final price (incl. GST)' : 'Final price'}</span>
              <span>{money(sale.salePrice)}</span>
            </div>
            {sale.saleType === 'subsidy' && (
              <>
                <div className="flex justify-between">
                  <span>Government subsidy{sale.subsidyScheme ? ` (${sale.subsidyScheme})` : ''}</span>
                  <span>-{money(sale.subsidyAmount)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Customer pays</span>
                  <span>{money(sale.customerPayable)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span>Advance paid at booking</span>
              <span>{money(sale.advancePaid)}</span>
            </div>
            <div className="flex justify-between">
              <span>Total received</span>
              <span>{money(sale.paidAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-400 pt-0.5 font-bold">
              <span>Balance</span>
              <span>{money(sale.balance)}</span>
            </div>
            <p className="pt-1 text-[11px] text-gray-600">
              Balance by {sale.paymentMode}
              {sale.paymentMode === 'Finance' && sale.financier && ` - ${sale.financier}, loan ${money(sale.loanAmount)}`}
            </p>
          </div>
        </div>
        <div className="border border-black">
          <p className="border-b border-black bg-gray-100 px-3 py-1 text-[11px] font-bold uppercase">Warranty and inspection</p>
          <div className="px-3 py-2">
            <table>
              <tbody>
                <Row
                  label="Warranty"
                  value={sale.warrantyMonths > 0 ? `${sale.warrantyMonths} months` : 'As per manufacturer policy'}
                />
                {warrantyStart && sale.warrantyMonths > 0 && (
                  <Row label="Valid" value={`${formatMessageDate(warrantyStart)} to ${formatMessageDate(warrantyEnd)}`} />
                )}
                <Row label="PDI" value={sale.pdiDone ? 'Completed' : 'Pending'} />
                {sale.pdiNotes && <Row label="PDI notes" value={sale.pdiNotes} />}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {sale.handoverNotes && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase text-gray-500">Handover notes</p>
          <p className="whitespace-pre-line">{sale.handoverNotes}</p>
        </div>
      )}

      <p className="mt-4 text-[11px]">
        I have received the above machine in good condition. Warranty is subject to the manufacturer&apos;s terms.
      </p>

      <div className="mt-14 grid grid-cols-3 gap-8 text-center text-[11px]">
        <div>
          <div className="border-t border-black pt-1">
            Customer signature
            {sale.receivedByName && <span className="block font-semibold">{sale.receivedByName}</span>}
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1">
            Driver signature
            {sale.driverName && <span className="block font-semibold">{sale.driverName}</span>}
          </div>
        </div>
        <div>
          <div className="border-t border-black pt-1">
            {company.signatoryLabel || `For ${company.displayName}`}
            <span className="block">Authorised signatory</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ChallanProps {
  sale: MachineSale;
  onClose: () => void;
}

export const DeliveryChallan: React.FC<ChallanProps> = ({ sale, onClose }) => {
  const { settings, showToast } = useERP();
  const { scope } = useApiScope();
  const { getCompany } = useCompanies();
  const company = getCompany(sale.companyId);
  const currency = settings.currencySymbol || '₹';
  const [sendingNote, setSendingNote] = useState(false);

  // The thank-you message also goes out by itself when the sale is delivered; this sends it again.
  const sendNote = async () => {
    if (!window.confirm(`Send the thank-you message to ${sale.customerName} on WhatsApp now?`)) return;
    setSendingNote(true);
    try {
      const r = await machineSaleApi.sendThankYou(scope, sale.id);
      if (r.status === 'sent') showToast('Thank-you sent', `Sent to ${sale.customerName} on WhatsApp.`, 'success');
      else showToast(r.status === 'skipped' ? 'Not sent' : r.status === 'queued' ? 'Not sent yet' : 'Could not send', r.detail, r.status === 'queued' ? 'warning' : 'error');
    } catch (e: any) {
      showToast('Could not send', e?.message || 'Please try again.', 'error');
    } finally {
      setSendingNote(false);
    }
  };

  return (
    <>
      <Modal
        title="Delivery challan"
        subtitle={`${sale.saleNumber} - ${sale.customerName}`}
        onClose={onClose}
        size="xl"
        actions={
          <>
            <SaleWhatsAppButton sale={sale} />
            {sale.status === 'Delivered' && (
              <button type="button" onClick={sendNote} disabled={sendingNote} className={BTN_GHOST} title="Send the thank-you message to the customer on WhatsApp">
                {sendingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send thank-you
              </button>
            )}
            <button type="button" onClick={() => window.print()} className={BTN_PRIMARY}>
              <Printer className="h-3.5 w-3.5" /> Print
            </button>
          </>
        }
      >
        <div className="bg-slate-100 p-4 dark:bg-slate-950">
          <div className="mx-auto max-w-[794px] shadow-sm">
            <ChallanSheet sale={sale} company={company} currency={currency} />
          </div>
        </div>
      </Modal>
      {/* Printed copy lives directly under body so the rest of the app can be hidden while printing. */}
      {createPortal(
        <div id="challan-print-root" className="print-only hidden bg-white">
          <style>{`@page { size: A4; margin: 10mm; } @media print { body > *:not(#challan-print-root) { display: none !important; } }`}</style>
          <ChallanSheet sale={sale} company={company} currency={currency} />
        </div>,
        document.body
      )}
    </>
  );
};
