import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SharedNetClient } from './client.mjs';
import { loadState, saveState } from './state.mjs';
import {
  decide,
  decideWithLLM,
  launchMessage,
  classifyMessage,
  buildPrompt,
  priceList,
  helpText,
} from './brain.mjs';
import { scanMessages, formatScan } from './scan.mjs';
import { codexReply } from './llm.mjs';
import {
  createOrder,
  loadOrders,
  saveOrders,
  matchPayments,
  quoteText,
  receiptText,
} from './settlement.mjs';

const SOFT_OFFER = 'Agora 可以帮上忙——@agora scan 看全场、@agora leads <你的产品> 找买家、@agora rebuttal 写反击。';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function run(opts = {}) {
  const st = await loadState();
  const roomId = process.env.SHAREDNET_ROOM || st?.roomId;
  if (!roomId) throw new Error('no room; run `agora account` first');

  const c = new SharedNetClient({
    baseUrl: process.env.SHAREDNET_BASE || st?.baseUrl || 'https://www.sharednet.ai',
    roomId,
  });
  if (st?.memberToken) {
    c.memberToken = st.memberToken;
    c.memberId = st.memberId;
  }
  if (!c.memberToken) throw new Error('no member token; run `agora account` first');

  const logPath = opts.log || process.env.CITY_LOG || join(process.cwd(), 'city.log');
  const pausePath = opts.pause || process.env.CITY_PAUSE || join(process.cwd(), '.city-pause');
  const ordersPath = opts.orders || process.env.CITY_ORDERS || join(process.cwd(), '.city-orders.json');
  let after = st?.lastSequence ?? 0;
  const ownName = st?.name || 'agora';
  const recent = [];
  const myMessageIds = new Set();
  const engage = Boolean(opts.engage);
  const market = Boolean(opts.market);
  const reply = (p) => codexReply(p, { cwd: process.cwd(), model: opts.model });
  let lastOpportunityAt = 0;
  let opportunityCount = 0;
  let lastSettleAt = 0;
  const orders = await loadOrders(ordersPath);

  const log = async (entry) => {
    try {
      await appendFile(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    } catch {
      /* logging is best-effort */
    }
  };

  console.error(`daemon: room=${roomId} member=${c.memberId} from=#${after} market=${market} engage=${engage} log=${logPath}`);

  if (opts.launch) {
    const page = await c.read({ limit: 100, order: 'asc' });
    for (const m of page.items || []) recent.push(m);
    const scan = formatScan(scanMessages(recent), { room: roomId });
    const res = await c.say(launchMessage(scan));
    const id = res.id ?? res.message?.id;
    if (id) myMessageIds.add(id);
    await log({ level: 'info', event: 'launch', sequence: res.sequence ?? res.message?.sequence ?? null });
  }

  async function marketReplies(items, ctx) {
    const scan = scanMessages(ctx.recent || []);
    const out = [];
    for (const m of items) {
      const cm = classifyMessage(m, ctx);
      if (cm.opportunity) {
        out.push({ replyTo: m.id, text: SOFT_OFFER, kind: 'opportunity' });
        continue;
      }
      if (!cm.direct) continue;
      if (['leads', 'rebuttal', 'live'].includes(cm.kind)) {
        const order = createOrder({
          roomId,
          from: m.sender?.name || m.sender_instance_id || '?',
          service: cm.kind,
          request: (m.content || '').trim(),
        });
        orders.push(order);
        await saveOrders(orders, ordersPath);
        out.push({ replyTo: m.id, text: quoteText(order), kind: 'direct' });
      } else if (cm.kind === 'scan') {
        out.push({ replyTo: m.id, text: formatScan(scan, { room: roomId }), kind: 'direct' });
      } else if (cm.kind === 'price') {
        out.push({ replyTo: m.id, text: priceList(), kind: 'direct' });
      } else if (cm.kind === 'help') {
        out.push({ replyTo: m.id, text: helpText(), kind: 'direct' });
      } else {
        out.push({
          replyTo: m.id,
          text: String(await reply(buildPrompt('general', (m.content || '').trim(), ctx.recent || [])) || '').slice(0, 3000),
          kind: 'direct',
        });
      }
    }
    return out;
  }

  async function settle() {
    try {
      const res = await c.transfers({ limit: 50 });
      const newlyPaid = matchPayments(res.items || [], orders);
      for (const o of newlyPaid) {
        const content = String(await reply(buildPrompt(o.service, o.request, recent)) || '').slice(0, 3000);
        await c.say(receiptText(o, content));
        o.status = 'delivered';
        o.deliveredAt = new Date().toISOString();
        await log({ level: 'info', event: 'deliver', order: o.id, service: o.service });
      }
      await saveOrders(orders, ordersPath);
    } catch (e) {
      await log({ level: 'info', event: 'settle_skip', message: e.message });
    }
  }

  let loops = 0;
  while (true) {
    if (existsSync(pausePath)) {
      console.error('daemon: paused (kill-switch file present), sleeping 10s');
      await sleep(10000);
      continue;
    }

    let page;
    try {
      page = await c.wait(after, { timeout: opts.once ? 0 : undefined });
    } catch (e) {
      await log({ level: 'error', event: 'wait_error', message: e.message });
      if (/invite_revoked|invite_expired|invalid_credentials|room_closed/i.test(e.message)) throw e;
      await sleep(5000);
      continue;
    }

    const items = (page.items || []).filter(
      (m) =>
        m &&
        m.sender_instance_id !== c.memberId &&
        m.sender?.member_id !== c.memberId &&
        !(ownName && m.sender?.name === ownName)
    );

    if (items.length) {
      for (const m of items) {
        recent.push(m);
        await log({
          level: 'info',
          event: 'message',
          seq: m.sequence,
          from: m.sender?.name || m.sender_instance_id,
          content: (m.content || '').slice(0, 500),
        });
      }
      if (recent.length > 200) recent.splice(0, recent.length - 200);
      after = Math.max(after, ...items.map((m) => m.sequence));
      await saveState({ ...(await loadState()), lastSequence: after });

      let replies = [];
      try {
        const ctx = { roomId, memberId: c.memberId, recent, myMessageIds, engage };
        if (market) replies = await marketReplies(items, ctx);
        else if (opts.llm) replies = await decideWithLLM(items, ctx, reply);
        else replies = decide(items, ctx);
      } catch (e) {
        await log({ level: 'error', event: 'decide_error', message: e.message });
      }

      for (const r of replies) {
        if (r.kind === 'opportunity') {
          const now = Date.now();
          if (now - lastOpportunityAt < 10 * 60 * 1000 || opportunityCount >= 20) {
            await log({ level: 'info', event: 'skip_opportunity', reply_to: r.replyTo, reason: 'cooldown_or_cap' });
            continue;
          }
          lastOpportunityAt = now;
          opportunityCount += 1;
        }
        try {
          const res = await c.say(r.text, { replyTo: r.replyTo });
          const id = res.id ?? res.message?.id;
          if (id) myMessageIds.add(id);
          await log({
            level: 'info',
            event: 'reply',
            reply_to: r.replyTo,
            sequence: res.sequence ?? res.message?.sequence ?? null,
            text: r.text.slice(0, 300),
          });
        } catch (e) {
          await log({ level: 'error', event: 'reply_error', message: e.message });
        }
      }
    }

    if (market && Date.now() - lastSettleAt > 20000) {
      lastSettleAt = Date.now();
      await settle();
    }

    if (opts.once) break;
    loops += 1;
    if (loops % 12 === 0) {
      try {
        const b = await c.balance();
        await log({ level: 'info', event: 'balance', credits: b.credits ?? b });
      } catch (e) {
        await log({ level: 'info', event: 'balance_skip', message: e.message });
      }
    }
  }
}
