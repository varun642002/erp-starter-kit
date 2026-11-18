// Checks the cash rules (no database needed):  npm run test:cash
import assert from 'node:assert/strict';
import { bucketOf, cashAfterHandover, cashInHandNow, daysSince, expectedCash, handoverProblem, round2 } from '../../src/db/cashMath.ts';

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e: any) {
    console.error(`FAIL ${name}\n     ${e.message}`);
    process.exitCode = 1;
  }
};

test('payment methods land in the right column', () => {
  assert.equal(bucketOf('Cash', false), 'cash');
  assert.equal(bucketOf('  cash ', false), 'cash');
  assert.equal(bucketOf('UPI', false), 'upi');
  assert.equal(bucketOf('Bank Transfer', false), 'bank');
  assert.equal(bucketOf('Cheque', true), 'bank');
  assert.equal(bucketOf(null, false), 'bank');
});

test('credit counts only for quick sales, and a credit card is not credit', () => {
  assert.equal(bucketOf('Credit', true), 'credit');
  assert.equal(bucketOf('Credit', false), 'bank');
  assert.equal(bucketOf('Credit Card', true), 'bank');
});

test('expected cash is opening + cash sales + service cash + cash in - cash out', () => {
  assert.equal(expectedCash(10000, 5000, 1000, 500, 2000), 14500);
  assert.equal(expectedCash(0, 0, 0, 0, 0), 0);
  assert.equal(expectedCash(100.1, 0.2, 0, 0, 0), 100.3); // no floating point drift
});

test('a handover takes cash off the giving branch (cash out is a negative manual movement)', () => {
  // the branch counted 20,000 yesterday, sold 8,000 in cash today and handed 12,000 to the Head Office
  const r = cashInHandNow(20000, { quick: 8000, machine: 0, invoices: 0, service: 0, manual: -12000 });
  assert.equal(r.movementSince, -4000);
  assert.equal(r.cashInHand, 16000);
});

test('every kind of cash coming in is counted once', () => {
  const r = cashInHandNow(1000, { quick: 100, machine: 200, invoices: 300, service: 400, manual: 500 });
  assert.equal(r.movementSince, 1500);
  assert.equal(r.cashInHand, 2500);
});

test('the Head Office gets the cash only when it is confirmed (manual in)', () => {
  const before = cashInHandNow(5000, { quick: 0, machine: 0, invoices: 0, service: 0, manual: 0 }).cashInHand;
  const onTheWay = cashInHandNow(5000, { quick: 0, machine: 0, invoices: 0, service: 0, manual: 0 }).cashInHand; // nothing booked yet
  const confirmed = cashInHandNow(5000, { quick: 0, machine: 0, invoices: 0, service: 0, manual: 12000 }).cashInHand;
  assert.equal(before, onTheWay);
  assert.equal(confirmed, 17000);
});

test('handing over more than the branch holds is flagged', () => {
  assert.deepEqual(cashAfterHandover(5000, 3000), { after: 2000, short: false });
  assert.deepEqual(cashAfterHandover(5000, 5000), { after: 0, short: false });
  assert.deepEqual(cashAfterHandover(5000, 6500.5), { after: -1500.5, short: true });
});

test('days since the last close', () => {
  assert.equal(daysSince('2026-11-04', '2026-11-06'), 2);
  assert.equal(daysSince('2026-11-06', '2026-11-06'), 0);
  assert.equal(daysSince(null, '2026-11-06'), 9999);
  assert.equal(daysSince('2026-12-01', '2026-11-06'), 0); // never negative
});

test('handover rules', () => {
  const ok = { amount: 1000, from: 'branch-2', to: 'branch-1', isOwner: false, actorBranchId: 'branch-2' };
  assert.equal(handoverProblem(ok), null);
  assert.equal(handoverProblem({ ...ok, amount: 0 })?.status, 400);
  assert.equal(handoverProblem({ ...ok, amount: -5 })?.status, 400);
  assert.equal(handoverProblem({ ...ok, amount: Number.NaN })?.status, 400);
  assert.equal(handoverProblem({ ...ok, amount: 200_000_000 })?.status, 400);
  assert.equal(handoverProblem({ ...ok, to: 'branch-2' })?.message, 'The cash cannot be handed over to the same branch.');
  assert.equal(handoverProblem({ ...ok, to: '' })?.status, 400);
  assert.equal(handoverProblem({ ...ok, actorBranchId: 'branch-3' })?.status, 403); // a branch person cannot hand over another branch's cash
  assert.equal(handoverProblem({ ...ok, actorBranchId: 'branch-3', isOwner: true }), null); // an owner can
});

test('rounding', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(10), 10);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
