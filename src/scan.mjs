const PITCH_RE = /\b(offer|sell|service|product|price|credits?|cli|mcp|install|服务|产品|价格|积分|提供|出售|调用|购买|收费)\b/i;
const ASK_RE = /[?？]|\b(who|how|which|why|buy|need|help)\b|谁|怎么|如何|哪|需要|帮忙/i;

export function scanMessages(items = []) {
  const members = new Map();
  const pitches = [];
  const asks = [];

  for (const m of items) {
    if (!m) continue;
    const sid = m.sender?.member_id || m.sender_instance_id || 'unknown';
    const name = m.sender?.name || m.sender_instance_id || 'unnamed';

    let rec = members.get(sid);
    if (!rec) {
      rec = { id: sid, name, count: 0, firstSeq: m.sequence, lastSeq: m.sequence, lastAt: m.created_at };
      members.set(sid, rec);
    }
    rec.count += 1;
    if (m.sequence > rec.lastSeq) {
      rec.lastSeq = m.sequence;
      rec.lastAt = m.created_at;
    }

    const c = (m.content || '').trim();
    if (!c) continue;
    const urls = [...c.matchAll(/https?:\/\/[^\s)>"']+/g)].map((x) => x[0]);
    const isPitch = urls.length > 0 || PITCH_RE.test(c);
    const isAsk = ASK_RE.test(c);
    if (isPitch) {
      pitches.push({ seq: m.sequence, member: sid, name, snippet: c.slice(0, 220), urls });
    }
    if (isAsk && !isPitch) {
      asks.push({ seq: m.sequence, member: sid, name, snippet: c.slice(0, 160) });
    }
  }

  return {
    total: items.length,
    members: [...members.values()].sort((a, b) => a.firstSeq - b.firstSeq),
    pitches,
    asks,
  };
}

export function formatScan(s, ctx = {}) {
  const lines = [];
  lines.push(
    `# scan ${ctx.room || ''} · ${s.total} messages · ${s.members.length} members · ${s.pitches.length} pitch-like · ${s.asks.length} asks`
  );
  if (s.members.length) {
    lines.push('');
    lines.push('## members');
    for (const m of s.members) {
      lines.push(`- ${m.id}  ${m.name}  (${m.count} msgs, last #${m.lastSeq})`);
    }
  }
  if (s.pitches.length) {
    lines.push('');
    lines.push('## pitch-like');
    for (const p of s.pitches) {
      lines.push(`- #${p.seq} ${p.name}: ${p.snippet}${p.urls.length ? '  ' + p.urls.join(' ') : ''}`);
    }
  }
  if (s.asks.length) {
    lines.push('');
    lines.push('## asks');
    for (const a of s.asks) {
      lines.push(`- #${a.seq} ${a.name}: ${a.snippet}`);
    }
  }
  return lines.join('\n');
}
