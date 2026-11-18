// Saves the A4 pages of a printed document (invoice, tax invoice, quotation) as one PDF file.
// Every <section> inside `container` is one page. The libraries are loaded only when a PDF is asked for.

const A4_W_MM = 210;
const A4_H_MM = 297;

export async function downloadSheetsAsPdf(container: HTMLElement, fileName: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas-pro'), import('jspdf')]);

  const pages = Array.from(container.querySelectorAll('section')) as HTMLElement[];
  if (pages.length === 0) throw new Error('There is nothing to download yet.');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  let first = true;

  for (const page of pages) {
    const canvas = await html2canvas(page, {
      scale: 2.5, // sharp text when zoomed or printed
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: Math.max(page.scrollWidth, 900)
    });
    // The page is as wide as A4; a very long invoice runs over to more pages, one A4 slice at a time.
    const totalMm = (canvas.height / canvas.width) * A4_W_MM;
    const slices = Math.max(1, Math.ceil(totalMm / A4_H_MM - 0.02));
    const sliceHeightPx = Math.floor((A4_H_MM / totalMm) * canvas.height);

    for (let i = 0; i < slices; i++) {
      const y = i * sliceHeightPx;
      const h = Math.min(sliceHeightPx, canvas.height - y);
      if (h <= 0) break;
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (!first) pdf.addPage('a4', 'portrait');
      first = false;
      pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W_MM, (h / canvas.width) * A4_W_MM, undefined, 'FAST');
    }
  }

  pdf.save(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}
