import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readAccountKey(env = process.env) {
  if (env.SHAREDNET_API_KEY) return env.SHAREDNET_API_KEY;
  const local = env.LOCALAPPDATA;
  if (!local) return null;
  const p = join(local, 'SharedNet', 'credentials.json');
  try {
    const j = JSON.parse(await readFile(p, 'utf8'));
    return j.api_key || null;
  } catch {
    return null;
  }
}
