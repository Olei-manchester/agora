#!/usr/bin/env node
// Minimal MCP server over stdio (JSON-RPC, newline-delimited).
// Entry: node src/mcp.mjs
import { scanMessages, formatScan } from './scan.mjs';
import { priceList, buildPrompt } from './brain.mjs';
import { codexReply } from './llm.mjs';
import { loadState } from './state.mjs';
import { SharedNetClient } from './client.mjs';

const SERVER_INFO = { name: 'agora', version: '0.1.0' };

const TOOLS = [
  {
    name: 'scan',
    description: 'Market snapshot of the SharedNet room: members, pitches, asks (free).',
    inputSchema: { type: 'object', properties: { room_id: { type: 'string' } } },
  },
  {
    name: 'price',
    description: 'Agora price list.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'leads',
    description: 'Find up to 3 agents in the room most likely to buy the given product (LLM).',
    inputSchema: { type: 'object', properties: { product: { type: 'string' }, room_id: { type: 'string' } }, required: ['product'] },
  },
  {
    name: 'rebuttal',
    description: 'Write an evidence-based rebuttal to an attack (LLM).',
    inputSchema: { type: 'object', properties: { attack: { type: 'string' }, room_id: { type: 'string' } }, required: ['attack'] },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function getRecent(roomId) {
  const st = await loadState();
  const c = new SharedNetClient({
    baseUrl: st?.baseUrl || process.env.SHAREDNET_BASE || 'https://www.sharednet.ai',
    roomId: roomId || st?.roomId,
    memberToken: st?.memberToken,
  });
  if (!c.roomId || !c.memberToken) return [];
  const page = await c.read({ limit: 100, order: 'desc' });
  return (page.items || []).slice().reverse();
}

async function callTool(name, args = {}) {
  if (name === 'price') return { content: [{ type: 'text', text: priceList() }] };
  if (name === 'scan') {
    const recent = await getRecent(args.room_id);
    return { content: [{ type: 'text', text: formatScan(scanMessages(recent), { room: args.room_id || '' }) }] };
  }
  if (name === 'leads' || name === 'rebuttal') {
    const recent = await getRecent(args.room_id);
    const ask = name === 'leads' ? `My product: ${args.product}. Find the agents most likely to buy it.` : args.attack;
    const text = await codexReply(buildPrompt(name, ask, recent));
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text: 'unknown tool: ' + name }], isError: true };
}

function handle(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    /* no response */
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
  } else if (msg.method === 'tools/call') {
    callTool(msg.params?.name, msg.params?.arguments || {}).then(
      (result) => send({ jsonrpc: '2.0', id: msg.id, result }),
      (err) =>
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: String(err.message || err) }], isError: true },
        })
    );
  } else if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
