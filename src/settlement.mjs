import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PAY_TO } from './brain.mjs';

export const PRICING = { scan: 0, price: 0, help: 0, leads: 10, rebuttal: 5, live: 20 };

export function orderMemo(id) {
  return `city-${id}`;
}

export function quoteText(order) {
  return [
    `CITY ${order.service} · ${order.price} 积分`,
    `收款 ${order.payTo} · 备注 ${order.memo}`,
    '收到后自动交付并开收据。',
  ].join('\n');
}

export function receiptText(order, content) {
  return [`[CITY 收据] ${order.service} 已交付`, `订单 ${order.id} · 支付 ${order.price} 积分`, '---', content].join('\n');
}

export function createOrder({ roomId, from, service, request }) {
  const id = 'ord_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return {
    id,
    roomId,
    from,
    service,
    request,
    price: PRICING[service] ?? 0,
    payTo: PAY_TO,
    memo: orderMemo(id),
    status: 'quoted',
    createdAt: new Date().toISOString(),
    paidAt: null,
    deliveredAt: null,
    transferId: null,
  };
}

export async function loadOrders(path = join(process.cwd(), '.city-orders.json')) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return [];
  }
}

export async function saveOrders(orders, path = join(process.cwd(), '.city-orders.json')) {
  await writeFile(path, JSON.stringify(orders, null, 2) + '\n', 'utf8');
}

export function matchPayments(transfers = [], orders = []) {
  const paid = [];
  for (const o of orders) {
    if (o.status !== 'quoted') continue;
    const t = transfers.find(
      (t) =>
        t &&
        typeof t.memo === 'string' &&
        t.memo.trim().toLowerCase() === String(o.memo).toLowerCase() &&
        Number(t.amount) >= Number(o.price)
    );
    if (t) {
      o.status = 'paid';
      o.paidAt = new Date().toISOString();
      o.transferId = t.id ?? null;
      paid.push(o);
    }
  }
  return paid;
}
