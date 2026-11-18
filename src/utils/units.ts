// Selling units. A product's stock is always counted in its own unit (pieces for a blade). A product can also be sold
// in a second unit that holds a fixed number of the first, for example a Box of 18 blades. Stock, the stock ledger and
// the stock checks all work in the product's own unit; the second unit is converted on the way in and shown beside it.

export interface UnitProduct {
  unit?: string | null;
  alternateUnit?: string | null;
  conversionFactor?: number | null;
}

export interface UnitOption {
  unit: string;
  factor: number; // how many of the product's own unit one of this unit holds
}

export const UNIT_CHOICES = ['Piece', 'Box', 'Kg'] as const;

// Short word shown after a number.
export function unitWord(unit: string | null | undefined, count = 2): string {
  const u = String(unit || '').toLowerCase();
  if (!u || u === 'nos' || u === 'piece' || u === 'pcs') return count === 1 ? 'pc' : 'pcs';
  if (u === 'box') return count === 1 ? 'box' : 'boxes';
  if (u === 'kg') return 'kg';
  return String(unit);
}

// A second unit only counts when it is different from the first and holds a whole number (2 or more) of it.
export function altUnitOf(p: UnitProduct | null | undefined): UnitOption | null {
  if (!p?.alternateUnit) return null;
  const factor = Number(p.conversionFactor);
  if (!Number.isInteger(factor) || factor < 2) return null;
  const alt = String(p.alternateUnit);
  if (alt.toLowerCase() === String(p.unit || '').toLowerCase()) return null;
  return { unit: alt, factor };
}

// The units a product can be sold in: its own unit first, then the second unit when it has one.
export function unitOptions(p: UnitProduct | null | undefined): UnitOption[] {
  const base: UnitOption = { unit: String(p?.unit || 'Nos'), factor: 1 };
  const alt = altUnitOf(p);
  return alt ? [base, alt] : [base];
}

// How many of the product's own unit one `unit` holds, or null when the product is not sold in that unit.
export function factorFor(p: UnitProduct | null | undefined, unit: string | null | undefined): number | null {
  const wanted = String(unit || '').toLowerCase();
  if (!wanted) return 1;
  const found = unitOptions(p).find((o) => o.unit.toLowerCase() === wanted);
  return found ? found.factor : null;
}

// Stock as people read it: "93 pcs" for a plain item, "93 pcs (5 boxes + 3 pcs)" for one that is also sold in boxes.
export function formatStock(qty: number, p: UnitProduct | null | undefined): string {
  const n = Number.isFinite(qty) ? qty : 0;
  const base = unitWord(p?.unit, n);
  const alt = altUnitOf(p);
  if (!alt || n < alt.factor) return `${n.toLocaleString('en-IN')} ${base}`;
  const boxes = Math.floor(n / alt.factor);
  const rest = n % alt.factor;
  const parts = [`${boxes.toLocaleString('en-IN')} ${unitWord(alt.unit, boxes)}`];
  if (rest > 0) parts.push(`${rest} ${unitWord(p?.unit, rest)}`);
  return `${n.toLocaleString('en-IN')} ${base} (${parts.join(' + ')})`;
}

// "5 boxes + 3 pcs" for a stock count of an item that is also sold in boxes, otherwise null.
export function stockBreakdown(qty: number, p: UnitProduct | null | undefined): string | null {
  const alt = altUnitOf(p);
  if (!alt || !Number.isFinite(qty) || qty < alt.factor) return null;
  const boxes = Math.floor(qty / alt.factor);
  const rest = qty % alt.factor;
  return rest > 0
    ? `${boxes.toLocaleString('en-IN')} ${unitWord(alt.unit, boxes)} + ${rest} ${unitWord(p?.unit, rest)}`
    : `${boxes.toLocaleString('en-IN')} ${unitWord(alt.unit, boxes)}`;
}

// The unit a new sale line starts with: the Box for items sold by the box (blades), otherwise the item's own unit.
export function defaultSaleUnit(p: UnitProduct | null | undefined): UnitOption {
  const alt = altUnitOf(p);
  if (alt && alt.unit.toLowerCase() === 'box') return alt;
  return { unit: String(p?.unit || 'Nos'), factor: 1 };
}
