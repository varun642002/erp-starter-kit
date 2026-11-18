import { useEffect } from 'react';

// Wide data tables cannot be read on a phone: only the first column fits and the rest hides behind a sideways scroll.
// This tags every wide data table in the page with the column names so the phone styles in index.css can show each
// row as a small card (a field name above each value). Desktop and tablet layouts are not touched.
//
// A table is left alone when it:
//  - has fewer than 5 columns (it already fits) unless it carries data-stack,
//  - sits inside a pop-up (import previews and similar keep their sideways scroll),
//  - is a printed sheet (no "w-full" class, or "border-collapse"),
//  - or carries the data-no-stack attribute (grids such as the attendance calendar).
const MIN_COLUMNS = 5;

function tag(table: HTMLTableElement) {
  if (table.hasAttribute('data-no-stack')) return;
  const cls = table.className || '';
  if (typeof cls !== 'string' || !cls.includes('w-full') || cls.includes('border-collapse') || cls.includes('border-separate')) return;
  if (table.closest('[data-no-stack], .fixed')) return;

  const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!headRow) return;
  const labels: string[] = [];
  for (const th of Array.from(headRow.cells)) {
    const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < Math.max(1, th.colSpan); i++) labels.push(text);
  }
  if (labels.length < MIN_COLUMNS && !table.hasAttribute('data-stack')) return;

  table.setAttribute('data-rt', '1');
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      let primarySet = false;
      for (const cell of Array.from(row.cells)) {
        const label = cell.colSpan > 1 ? '' : labels[col] || '';
        cell.setAttribute('data-label', label);
        // the first column that has a name is the row's title: shown big, with no field name
        if (label && !primarySet) {
          cell.setAttribute('data-primary', '1');
          primarySet = true;
        } else {
          cell.removeAttribute('data-primary');
        }
        col += Math.max(1, cell.colSpan);
      }
    }
  }
}

export const ResponsiveTables = () => {
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>('main table').forEach(tag);
    };
    const schedule = () => {
      if (!frame) frame = window.setTimeout(scan, 60);
    };
    schedule();
    // childList only: tagging changes attributes, which must not trigger another scan
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.clearTimeout(frame);
    };
  }, []);
  return null;
};
