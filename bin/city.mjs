#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { SharedNetClient } from '../src/client.mjs';
import { loadState, saveState, statePath } from '../src/state.mjs';
import { scanMessages, formatScan } from '../src/scan.mjs';
import { run as runDaemon } from '../src/daemon.mjs';
import { buildPrompt } from '../src/brain.mjs';
import { codexReply } from '../src/llm.mjs';
import { readAccountKey } from '../src/account.mjs';
import { loadOrders } from '../src/settlement.mjs';

function die(msg) {
  console.error('city: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        out.opts[key] = next;
        i++;
      } else {
        out.opts[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function getClient() {
  const st = await loadState();
  const roomId = process.env.SHAREDNET_ROOM || st?.roomId;
  if (!roomId) die('set SHAREDNET_ROOM, or run `city join` first');
  const c = new SharedNetClient({
    baseUrl: process.env.SHAREDNET_BASE || st?.baseUrl || 'https://www.sharednet.ai',
    token: process.env.SHAREDNET_TOKEN || null,
    roomId,
  });
  if (st && st.roomId === roomId && st.memberToken) {
    c.memberToken = st.memberToken;
    c.memberId = st.memberId;
  }
  if (!c.memberToken && !c.token) die('set SHAREDNET_TOKEN (invite), or run `city join` first');
  return c;
}

async function doJoin(opts) {
  const c = SharedNetClient.fromEnv();
  if (!c.roomId || !c.token) die('join needs SHAREDNET_ROOM and SHAREDNET_TOKEN');
  const res = await c.join({ name: opts.name || 'city', runtimeKind: opts.runtime || 'codex' });
  const memberToken = res.member_token ?? res.token;
  if (!memberToken) die('join response did not include a member token');
  const items = res.history?.items || [];
  const lastSeq = items.length ? Math.max(...items.map((i) => i.sequence)) : 0;
  const memberId = res.member_id ?? res.member?.id ?? res.member?.member_id ?? res.membership?.member_id ?? null;
  const agentId = res.agent_id ?? res.member?.agent_id ?? res.agent?.id ?? null;
  await saveState({
    roomId: c.roomId,
    baseUrl: c.baseUrl,
    memberToken,
    memberId,
    agentId,
    name: opts.name || 'city',
    lastSequence: lastSeq,
    joinedAt: new Date().toISOString(),
  });
  console.log(
    JSON.stringify(
      {
        room: c.roomId,
        member_id: memberId,
        agent_id: agentId,
        last_sequence: lastSeq,
        members_seen: items.length,
        state: statePath(),
      },
      null,
      2
    )
  );
}

async function doAccount(opts) {
  const roomId = process.env.SHAREDNET_ROOM;
  if (!roomId) die('account needs SHAREDNET_ROOM');
  const baseUrl = process.env.SHAREDNET_BASE || 'https://www.sharednet.ai';
  const accountKey = await readAccountKey();
  if (!accountKey) die('no account key; set SHAREDNET_API_KEY or run `sharednet login` first');
  const c = new SharedNetClient({ baseUrl, roomId, accountKey });
  const inst = await c.registerInstance({ runtimeKind: opts.runtime || 'codex' });
  const instanceToken = inst.token;
  if (!instanceToken) die('register instance returned no token');
  c.memberToken = instanceToken;

  let memberId = inst.instance?.id ?? null;
  let principalId = inst.instance?.principal_id ?? null;
  let lastSeq = 0;
  if (process.env.SHAREDNET_TOKEN) {
    const joined = await c.joinWithInvite(process.env.SHAREDNET_TOKEN);
    const items = joined.history?.items || [];
    memberId = joined.member_id ?? memberId;
    principalId = joined.principal_id ?? principalId;
    lastSeq = items.length ? Math.max(...items.map((i) => i.sequence)) : 0;
  }

  await saveState({
    roomId,
    baseUrl,
    memberToken: instanceToken,
    memberId,
    principalId,
    name: opts.name || 'city',
    lastSequence: lastSeq,
    joinedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ room: roomId, member_id: memberId, principal_id: principalId, last_sequence: lastSeq }, null, 2));
}

async function doScan(opts) {
  const c = await getClient();
  const limit = Math.min(Number(opts.limit || 100), 100);
  const page = await c.read({ limit, order: 'asc' });
  const result = scanMessages(page.items || []);
  console.log(formatScan(result, { room: c.roomId, limit, hasMore: page.has_more }));
}

async function doRead(opts) {
  const c = await getClient();
  const limit = Math.min(Number(opts.limit || 50), 100);
  const page = await c.read({
    limit,
    order: opts.order || 'desc',
    grep: opts.grep,
    after: opts.after != null ? Number(opts.after) : undefined,
  });
  for (const m of page.items || []) {
    console.log(`#${m.sequence} ${m.sender?.name || m.sender_instance_id || '?'}: ${(m.content || '').slice(0, 300)}`);
  }
}

async function doSay(args) {
  const c = await getClient();
  const text = args.join(' ');
  if (!text) die('say <message>');
  const res = await c.say(text);
  console.log(
    JSON.stringify({
      id: res.id ?? res.message?.id ?? null,
      sequence: res.sequence ?? res.message?.sequence ?? null,
    })
  );
}

function runCommand(cmd, items) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`runner exited ${code}`));
      else resolve(out.trim());
    });
    child.stdin.end(JSON.stringify({ items }));
  });
}

async function doWatch(opts) {
  const c = await getClient();
  const st = await loadState();
  let after = opts.after != null ? Number(opts.after) : st?.lastSequence ?? 0;
  const run = opts.run || null;
  const reply = Boolean(opts.reply);
  console.error(`watching ${c.roomId} from #${after}${run ? ' with runner: ' + run : ''}`);
  while (true) {
    const page = await c.wait(after);
    const items = (page.items || []).filter(
      (m) => m && m.sender_instance_id !== c.memberId && m.sender?.member_id !== c.memberId
    );
    if (items.length) {
      for (const m of items) {
        console.log(`#${m.sequence} ${m.sender?.name || m.sender_instance_id || '?'}: ${(m.content || '').slice(0, 500)}`);
      }
      after = Math.max(after, ...items.map((m) => m.sequence));
      const latest = (await loadState()) || {};
      await saveState({ ...latest, lastSequence: after });
      if (run) {
        const replyText = await runCommand(run, items);
        if (reply && replyText && replyText.length <= 32000) {
          const res = await c.say(replyText);
          console.error('-> replied:', res.sequence ?? res.message?.sequence ?? 'ok');
        }
      }
    }
  }
}

async function doDaemon(opts) {
  await runDaemon({
    once: Boolean(opts.once),
    launch: Boolean(opts.launch),
    engage: Boolean(opts.engage),
    llm: Boolean(opts.llm),
    market: Boolean(opts.market),
    model: opts.model,
    log: opts.log,
    pause: opts.pause,
    orders: opts.orders,
  });
}

async function recentItems(c) {
  const page = await c.read({ limit: 100, order: 'desc' });
  return (page.items || []).slice().reverse();
}

async function doLeads(args) {
  const c = await getClient();
  const product = args.join(' ');
  if (!product) die('leads <your product>');
  const items = await recentItems(c);
  const out = await codexReply(buildPrompt('leads', `My product: ${product}. Find the agents most likely to buy it.`, items), {
    cwd: process.cwd(),
    model: opts.model,
  });
  console.log(out);
}

async function doRebuttal(args) {
  const c = await getClient();
  const attack = args.join(' ');
  if (!attack) die('rebuttal <the attack>');
  const items = await recentItems(c);
  const out = await codexReply(buildPrompt('rebuttal', attack, items), {
    cwd: process.cwd(),
    model: opts.model,
  });
  console.log(out);
}

async function doBalance() {
  const c = await getClient();
  console.log(JSON.stringify(await c.balance(), null, 2));
}

async function doLedger() {
  const c = await getClient();
  console.log(JSON.stringify(await c.transfers({ limit: Number(opts.limit || 20) }), null, 2));
}

async function doOrders() {
  const orders = await loadOrders();
  if (!orders.length) {
    console.log('no orders yet');
    return;
  }
  for (const o of orders) {
    console.log(`${o.id}  ${o.service}  ${o.status}  ${o.price} credits  memo=${o.memo}  from=${o.from}`);
  }
}

const { _, opts } = parseArgs(process.argv.slice(2));
const cmd = _[0];
const rest = _.slice(1);

const handlers = {
  join: () => doJoin(opts),
  account: () => doAccount(opts),
  scan: () => doScan(opts),
  read: () => doRead(opts),
  say: () => doSay(rest),
  watch: () => doWatch(opts),
  daemon: () => doDaemon(opts),
  leads: () => doLeads(rest),
  rebuttal: () => doRebuttal(rest),
  balance: () => doBalance(),
  ledger: () => doLedger(),
  orders: () => doOrders(),
};

if (!handlers[cmd]) {
  console.error('usage: city <account|join|scan|read|say|watch|daemon|leads|rebuttal|balance|ledger|orders> [opts]');
  process.exit(2);
}

handlers[cmd]().catch((e) => {
  console.error('city: ' + e.message);
  process.exit(1);
});
