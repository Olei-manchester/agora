#!/usr/bin/env node
// Multi-role collaboration driver: architect -> builder -> reviewer, each as a
// NAMED guest seat in the room (so the room record shows clear roles).
// Run: node scripts/collab.mjs "task description"
import { SharedNetClient } from '../src/client.mjs';
import { codexReply } from '../src/llm.mjs';

const ROLES = [
  {
    name: 'codex-architect',
    persona: 'You are the architect. Write a concise architecture spec for the project described below: files, interfaces, and acceptance criteria. Under 250 words.',
  },
  {
    name: 'codex-builder',
    persona: 'You are the builder. Take the spec above and write a build report describing the implementation and how to run it, citing concrete files. Under 250 words.',
  },
  {
    name: 'codex-reviewer',
    persona: 'You are the reviewer. Review the spec and build report, point out 2-3 concrete risks and one go/no-go. Under 200 words.',
  },
];

const MODE = '\n\nRULES: Reply with a text message only. Do NOT call any tools, do NOT write files, and do NOT run commands. Output only your report, in English.';

function die(m) {
  console.error('collab: ' + m);
  process.exit(1);
}

async function main() {
  const task = process.argv.slice(2).join(' ').trim();
  const roomId = process.env.SHAREDNET_ROOM;
  const invite = process.env.SHAREDNET_TOKEN;
  if (!task) die('usage: node scripts/collab.mjs "<task>"');
  if (!roomId || !invite) die('set SHAREDNET_ROOM and SHAREDNET_TOKEN');

  const baseUrl = process.env.SHAREDNET_BASE || 'https://www.sharednet.ai';
  const history = [];
  for (const role of ROLES) {
    const c = new SharedNetClient({ baseUrl, roomId, token: invite });
    const joined = await c.join({ name: role.name, runtimeKind: 'codex' });
    const token = joined.member_token ?? joined.token;
    if (!token) die('join failed for ' + role.name);
    c.memberToken = token;
    c.memberId = joined.member_id;

    const ctx = history.map((m, i) => `[${ROLES[i].name}] ${m}`).join('\n\n');
    const prompt = `${role.persona}\n\nPROJECT:\n${task}\n\nCONTEXT SO FAR:\n${ctx || '(none)'}${MODE}`;
    const text = String((await codexReply(prompt, { cwd: process.cwd() })) || '').slice(0, 3000);
    if (!text) continue;
    await c.say(text);
    history.push(text);
    console.log(`# ${role.name}: ${text.slice(0, 140).replace(/\s+/g, ' ')}`);
  }
}

main().catch((e) => die(e.message));
