// Checks the STOP / START rules and Meta's signature check (no database needed):  npm run test:optouts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validSignature, wantsToStart, wantsToStop } from '../../src/db/optOuts.ts';

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

test('plain STOP replies are recognised', () => {
  for (const t of ['STOP', 'stop', ' Stop. ', 'Stop messages', 'unsubscribe', 'Opt out', 'optout', 'stop!!', 'Stop  all']) assert.equal(wantsToStop(t), true, t);
});

test('ordinary sentences are not treated as STOP', () => {
  for (const t of ['Please do not stop the delivery', 'Thanks, happy diwali', 'what time do you open', 'stopper bolt price', '', 'stop calling me at night', 'Cancel my booking', 'End of month payment?', 'quit']) assert.equal(wantsToStop(t), false, t);
});

test('START brings a customer back', () => {
  for (const t of ['START', 'start', 'Subscribe', ' Start! ']) assert.equal(wantsToStart(t), true, t);
  for (const t of ['stop', 'Start tractor service', 'Resume delivery?']) assert.equal(wantsToStart(t), false, t);
});

test("Meta's signature must match the exact body", () => {
  const secret = 'app-secret';
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(validSignature(body, good, secret), true);
  assert.equal(validSignature(body, good, 'other-secret'), false);
  assert.equal(validSignature(Buffer.from('{"entry":[1]}'), good, secret), false);
  assert.equal(validSignature(body, undefined, secret), false);
  assert.equal(validSignature(undefined, good, secret), false);
  assert.equal(validSignature(body, 'sha256=zz', secret), false);
  assert.equal(validSignature(body, 'md5=' + good.slice(7), secret), false);
});

console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
process.exit(process.exitCode ?? 0);
