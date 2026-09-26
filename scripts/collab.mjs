#!/usr/bin/env node
// Multi-role collaboration driver: architect -> builder -> reviewer, each as
// its own account seat in the room.
// Run: node scripts/collab.mjs "task description"
import { readAccountKey } from '../src/account.mjs';
import { SharedNetClient } from '../src/client.mjs';
import { codexReply } from '../src/llm.mjs';

const ROLES = [
  {
    name: 'codex-architect',
    persona: 'You are the architect. Break the task into a concrete spec: files, interfaces, and acceptance criteria. Under 250 words.',
  },
  {
    name: 'codex-builder',
    persona: 'You are the builder. Take the spec above and report what you implemented and how to run it, citing concrete changes. Under 250 words.',
  },
  {
    name: 'codex-reviewer',
    persona: 'You are the reviewer. Review the spec and build report, point out 2-3 concrete risks and one go/no-go. Under 200 words.',
  },
];

function die(m) {
  console.error('collab: ' + m);
  process.exit(1);
}

async function main() {
  const task = process.argv.slice(2).join(' ').trim();
  const roomId = process.env.SHAREDNET_ROOM;
  const invite = process.env.SHAREDNET_TOKEN;
  if (!task) die('usage: node scripts/collab.mjs "<task>"');
  if (!roomId) die('set SHAREDNET_ROOM');
  const accountKey = await readAccountKey();
  if (!accountKey) die('no account key; set SHAREDNET_API_KEY or run sharednet login');

  const baseUrl = process.env.SHAREDNET_BASE || 'https://www.sharednet.ai';
  const history = [];
  for (const role of ROLES) {
    const c = new SharedNetClient({ baseUrl, roomId, accountKey });
    const inst = await c.registerInstance({ runtimeKind: 'codex' });
    const token = inst.token;
    if (!token) die('register instance failed');
    c.memberToken = token;
    if (invite) await c.joinWithInvite(invite);

    const ctx = history.map((m, i) => `[${ROLES[i].name}] ${m}`).join('\n\n');
    const prompt = `${role.persona}\n\nTASK: ${task}\n\nCONTEXT SO FAR:\n${ctx || '(none)'}\n\nOutput ONLY your message.`;
    const text = String((await codexReply(prompt, { cwd: process.cwd() })) || '').slice(0, 3000);
    if (!text) continue;
    await c.say(text);
    history.push(text);
    console.log(`# ${role.name}: ${text.slice(0, 140).replace(/\s+/g, ' ')}`);
  }
}

main().catch((e) => die(e.message));
