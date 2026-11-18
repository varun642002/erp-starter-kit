// The cash rules, kept free of the database so they can be tested on their own (tests/cash/run.mts).

export type Bucket = 'cash' | 'upi' | 'bank' | 'credit';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Which cash book column a payment method belongs to. Credit only applies to quick sales (allowCredit).
export function bucketOf(method: string | null | undefined, allowCredit: boolean): Bucket {
  const m = (method || '').trim().toLowerCase();
  if (m === 'cash') return 'cash';
  if (m === 'upi') return 'upi';
  if (allowCredit && m.includes('credit') && !m.includes('card')) return 'credit';
  return 'bank';
}

// The cash the drawer should hold at the end of a day.
export function expectedCash(openingCash: number, cashSales: number, serviceCash: number, manualCashIn: number, manualCashOut: number): number {
  return round2(openingCash + cashSales + serviceCash + manualCashIn - manualCashOut);
}

// The cash a branch holds now: the cash counted at its last close plus every cash movement after that day.
export function cashInHandNow(counted: number, movement: { quick: number; machine: number; invoices: number; service: number; manual: number }): { movementSince: number; cashInHand: number } {
  const movementSince = round2(movement.quick + movement.machine + movement.invoices + movement.service + movement.manual);
  return { movementSince, cashInHand: round2(counted + movementSince) };
}

// What a branch's cash in hand becomes after it hands cash over; a negative result means it handed over more than it held.
export function cashAfterHandover(cashInHand: number, amount: number): { after: number; short: boolean } {
  const after = round2(cashInHand - amount);
  return { after, short: after < 0 };
}

// Whole days between two YYYY-MM-DD dates (a never-closed branch counts as 9999).
export function daysSince(lastClosed: string | null | undefined, today: string): number {
  if (!lastClosed) return 9999;
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastClosed}T00:00:00Z`)) / 86400000));
}

// Why a handover cannot be recorded, or null when it can.
export function handoverProblem(input: { amount: number; from: string; to: string; isOwner: boolean; actorBranchId: string }): { message: string; status: number } | null {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) return { message: 'Enter the amount handed over.', status: 400 };
  if (amount > 100_000_000) return { message: 'That amount looks too large. Check it and try again.', status: 400 };
  if (!input.from || !input.to) return { message: 'Choose the branch handing over and the branch receiving.', status: 400 };
  if (input.from === input.to) return { message: 'The cash cannot be handed over to the same branch.', status: 400 };
  if (!input.isOwner && input.from !== input.actorBranchId) return { message: 'You can only hand over cash from your own branch.', status: 403 };
  return null;
}
