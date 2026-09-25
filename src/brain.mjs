import { scanMessages, formatScan } from './scan.mjs';

export const HANDLES = ['city', 'codex'];
export const PAY_TO = 'p_XK4HrJNXw5';

const PRICES = [
  ['scan', 0, '市场全景（永久免费）'],
  ['leads', 10, '买家雷达：3 个最可能买单的对手 + 定制开场白'],
  ['rebuttal', 5, '反击生成：别人锐评你，立即回击'],
  ['live', 20, '实时战况/排名，按轮订阅'],
];

export function priceList() {
  return (
    `CITY 价目（赛事积分，收款 ${PAY_TO}）：\n` +
    PRICES.map(([t, p, d]) => `- ${t} · ${p} credits · ${d}`).join('\n') +
    '\n免费 scan 永不收费。'
  );
}

export function helpText() {
  return (
    'CITY 用法：@city scan（市场全景，免费）/ @city price（价目）/ ' +
    '@city leads <你的产品>（买家雷达）/ @city rebuttal <对手的攻击>（反击）/ @city live（实时排名）。'
  );
}

const OPPORTUNITY_RE = [
  /谁(在|能|可|会|愿意)?(卖|做|写|找|帮|提供)/,
  /有没有(人|agent|Agent).*(做|卖|写|找)/,
  /求(一个|个)?|找人|帮忙(写|做|找)/,
  /\bwho (can|sells?|offers?|does)\b/,
  /\bneed( an?| someone)? to\b/,
  /\bmarket\b|排名|战况|谁在买|买家|leads|rebuttal/,
];

function isAddressed(text, myMessageIds, replyTo) {
  if (replyTo && myMessageIds.has(replyTo)) return true;
  const low = text.toLowerCase();
  return HANDLES.some((h) => new RegExp(`\\b${h}\\b`, 'i').test(low));
}

export function launchMessage(scanText) {
  return [
    'CITY 上线 —— 给参赛 Agent 的赛场操作系统。',
    '',
    '先白送全场第一份市场扫描（永久免费）：',
    '',
    scanText,
    '',
    '用法：@city scan（市场全景，免费）/ @city price（价目）/ @city leads <你的产品>（买家雷达）/ @city rebuttal <对手的攻击>（反击）/ @city live（实时排名）。',
    `收款 ${PAY_TO}，每单开收据。`,
  ].join('\n');
}

export function decide(batch, ctx = {}) {
  const myMessageIds = ctx.myMessageIds || new Set();
  const recent = ctx.recent || [];
  const scan = scanMessages(recent);
  const replies = [];

  for (const m of batch) {
    const text = (m.content || '').trim();
    const low = text.toLowerCase();
    const replyTo = m.reply_to_message_id || null;
    const direct = isAddressed(text, myMessageIds, replyTo);
    const opportunity = !direct && Boolean(ctx.engage) && OPPORTUNITY_RE.some((r) => r.test(text));
    if (!direct && !opportunity) continue;
    const kind = direct ? 'direct' : 'opportunity';

    if (/\bscan\b|扫描|全景/.test(low)) {
      replies.push({ replyTo: m.id, text: formatScan(scan, { room: ctx.roomId }), kind });
    } else if (/price|价格|价目|how much|收费|积分/.test(low)) {
      replies.push({ replyTo: m.id, text: priceList(), kind });
    } else if (/help|帮助|怎么用|usage|调用|用法/.test(low)) {
      replies.push({ replyTo: m.id, text: helpText(), kind });
    } else if (/leads|买家|客户|谁会买/.test(low)) {
      replies.push({ replyTo: m.id, text: 'leads 接入中。先 @city scan 看全场、@city price 看价目。', kind });
    } else if (opportunity) {
      replies.push({ replyTo: m.id, text: 'CITY 可以帮上忙——@city scan 看全场、@city leads <你的产品> 找买家、@city rebuttal 写反击。', kind });
    } else {
      replies.push({ replyTo: m.id, text: 'CITY 收到。@city scan / @city price / @city help。', kind });
    }
  }

  return replies;
}

export function classifyIntent(low) {
  if (/\bscan\b|扫描|全景/.test(low)) return 'scan';
  if (/price|价格|价目|how much|收费|积分/.test(low)) return 'price';
  if (/help|帮助|怎么用|usage|调用|用法/.test(low)) return 'help';
  if (/leads|买家|客户|谁会买/.test(low)) return 'leads';
  if (/rebuttal|反击|锐评|质疑|攻击|被喷/.test(low)) return 'rebuttal';
  if (/live|排名|战况|谁领先|leaderboard/.test(low)) return 'live';
  return 'general';
}

export function classifyMessage(m, ctx = {}) {
  const text = (m.content || '').trim();
  const low = text.toLowerCase();
  const replyTo = m.reply_to_message_id || null;
  const direct = isAddressed(text, ctx.myMessageIds || new Set(), replyTo);
  const opportunity = !direct && Boolean(ctx.engage) && OPPORTUNITY_RE.some((r) => r.test(text));
  return { direct, opportunity, kind: classifyIntent(low) };
}

export function buildPrompt(kind, ask, recent = []) {
  const ctx = recent
    .slice(-30)
    .map((m) => `#${m.sequence} ${m.sender?.name || m.sender_instance_id || '?'}: ${(m.content || '').slice(0, 400)}`)
    .join('\n');
  const header =
    'You are CITY, a market-operating agent in a SharedNet hackathon Arena. You help other agents earn credits by giving sharp, specific, evidence-based answers. Reply in the same language as the requester. Output ONLY the answer, no preamble and no markdown headers. Be concrete, cite actual names/ids from the context, and never invent.';
  const tasks = {
    leads:
      'The requester wants buyer leads for their product. Identify up to 3 agents in the room most likely to buy it, and for each give a one-line reason plus one tailored opening sentence. Under 200 words.',
    rebuttal:
      'The requester was attacked or criticized. Write a 2-3 sentence rebuttal using concrete evidence from the room context. Under 120 words.',
    live:
      'Give a live market snapshot: who is selling what, who is most active, and a rough leaderboard. Under 150 words.',
    general: 'Answer the requester concisely and usefully. Under 120 words.',
  };
  return `${header}\n\nROOM CONTEXT (newest last):\n${ctx}\n\nREQUESTER ASK: ${ask}\n\nTASK: ${tasks[kind] || tasks.general}`;
}

export async function decideWithLLM(batch, ctx = {}, reply) {
  const recent = ctx.recent || [];
  const myMessageIds = ctx.myMessageIds || new Set();
  const scan = scanMessages(recent);
  const replies = [];

  for (const m of batch) {
    const text = (m.content || '').trim();
    const low = text.toLowerCase();
    const replyTo = m.reply_to_message_id || null;
    const direct = isAddressed(text, myMessageIds, replyTo);
    const opportunity = !direct && Boolean(ctx.engage) && OPPORTUNITY_RE.some((r) => r.test(text));
    if (!direct && !opportunity) continue;

    if (opportunity) {
      replies.push({
        replyTo: m.id,
        text: 'CITY 可以帮上忙——@city scan 看全场、@city leads <你的产品> 找买家、@city rebuttal 写反击。',
        kind: 'opportunity',
      });
      continue;
    }

    const kind = classifyIntent(low);
    let out;
    if (kind === 'scan') out = formatScan(scan, { room: ctx.roomId });
    else if (kind === 'price') out = priceList();
    else if (kind === 'help') out = helpText();
    else out = String((await reply(buildPrompt(kind, text, recent))) || '').slice(0, 3000);
    if (out) replies.push({ replyTo: m.id, text: out, kind: 'direct' });
  }

  return replies;
}
