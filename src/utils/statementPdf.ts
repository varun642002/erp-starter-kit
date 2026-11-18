// A one-customer account statement saved as a PDF: every unpaid bill and the total due.
// jsPDF is loaded only when a statement is asked for. Its standard fonts have no rupee sign, so amounts print as "Rs.".

export interface StatementLine {
  kind: string;
  number: string;
  dueDate?: string | null;
  daysOverdue: number;
  balance: number;
  payUrl?: string | null;
}

export interface StatementInput {
  companyName: string;
  customerName: string;
  phone?: string;
  lines: StatementLine[];
  fileName?: string;
}

const rs = (n: number) => `Rs. ${(Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export async function downloadStatementPdf(input: StatementInput): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const W = 210;
  const M = 16;
  const ROW = 8;
  let y = 20;

  const header = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(input.companyName, M, y);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100);
    pdf.text('Account statement', M, y + 6);
    pdf.text(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }), W - M, y, { align: 'right' });
    pdf.setTextColor(0);
    pdf.setDrawColor(200);
    pdf.line(M, y + 10, W - M, y + 10);
    y += 18;
  };
  const columns = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setFillColor(241, 245, 249);
    pdf.rect(M, y - 5.5, W - 2 * M, ROW, 'F');
    pdf.text('Bill', M + 2, y);
    pdf.text('Number', M + 38, y);
    pdf.text('Due by', M + 88, y);
    pdf.text('Late', M + 118, y);
    pdf.text('Balance', W - M - 2, y, { align: 'right' });
    y += ROW;
  };

  header();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(input.customerName, M, y);
  y += 5;
  if (input.phone) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Phone: ${input.phone}`, M, y);
    y += 5;
  }
  y += 5;
  columns();

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  let total = 0;
  for (const l of input.lines) {
    if (y > 270) {
      pdf.addPage();
      y = 20;
      columns();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
    }
    total += l.balance;
    pdf.text(l.kind, M + 2, y);
    pdf.text(l.number, M + 38, y);
    pdf.text(l.dueDate || '-', M + 88, y);
    pdf.text(l.daysOverdue > 0 ? `${l.daysOverdue} days` : '-', M + 118, y);
    pdf.text(rs(l.balance), W - M - 2, y, { align: 'right' });
    pdf.setDrawColor(235);
    pdf.line(M, y + 2.5, W - M, y + 2.5);
    y += ROW;
    if (l.payUrl) {
      pdf.setFontSize(8);
      pdf.setTextColor(37, 99, 235);
      pdf.textWithLink('Pay online', M + 38, y - 2.5, { url: l.payUrl });
      pdf.setTextColor(0);
      pdf.setFontSize(9);
      y += 3;
    }
  }

  if (y > 255) {
    pdf.addPage();
    y = 20;
  }
  y += 4;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Total due', M + 2, y);
  pdf.text(rs(total), W - M - 2, y, { align: 'right' });
  y += 12;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(100);
  pdf.text('Kindly arrange the payment. Thank you.', M, y);

  const safe = (input.fileName || `Statement-${input.customerName}`).replace(/[^\w.-]+/g, '_').slice(0, 80);
  pdf.save(safe.endsWith('.pdf') ? safe : `${safe}.pdf`);
}
