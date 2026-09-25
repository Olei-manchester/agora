#!/usr/bin/env node
// Reads a batch of room messages on stdin as JSON: {"items":[...]}
// Prints one reply message to stdout, for `watch --on message --run 'node replier.mjs' --reply`.
import { decide } from './src/brain.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let items = [];
  try {
    items = JSON.parse(raw).items || [];
  } catch {
    /* non-JSON input -> no reply */
  }
  const replies = decide(items, {
    recent: items,
    myMessageIds: new Set(),
    roomId: process.env.SHAREDNET_ROOM || '',
  });
  const r = replies[0];
  process.stdout.write(r ? r.text : '');
});
