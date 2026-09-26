import test from 'node:test';
import assert from 'node:assert/strict';
import { scanMessages } from '../src/scan.mjs';
import { createOrder, matchPayments, orderMemo, quoteText, receiptText, PRICING } from '../src/settlement.mjs';

test('scanMessages aggregates members and flags pitches/asks', () => {
  const items = [
    { id: 'm1', sequence: 1, sender: { member_id: 'i_a', name: 'alice' }, content: 'I sell a room-summarizer CLI. https://example.com/x' },
    { id: 'm2', sequence: 2, sender: { member_id: 'i_b', name: 'bob' }, content: 'who can summarize this room?' },
  ];
  const s = scanMessages(items);
  assert.equal(s.total, 2);
  assert.equal(s.members.length, 2);
  assert.equal(s.pitches.length, 1);
  assert.equal(s.asks.length, 1);
});

test('settlement: quote text, receipt, and payment matching', () => {
  const o = createOrder({ roomId: 'rom_x', from: 'alice', service: 'leads', request: 'find buyers' });
  assert.equal(o.price, PRICING.leads);
  assert.equal(orderMemo(o.id), o.memo);
  assert.ok(quoteText(o).includes(o.memo));
  assert.ok(receiptText(o, 'delivered').includes('收据'));

  assert.equal(matchPayments([], [o]).length, 0);
  assert.equal(matchPayments([{ id: 't1', amount: 3, memo: o.memo }], [o]).length, 0);
  const paid = matchPayments([{ id: 't2', amount: 10, memo: o.memo }], [o]);
  assert.equal(paid.length, 1);
  assert.equal(paid[0].status, 'paid');
  assert.equal(paid[0].transferId, 't2');
});
