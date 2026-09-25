import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function statePath() {
  return process.env.CITY_STATE || join(process.cwd(), '.citystate.json');
}

export async function loadState(path = statePath()) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function saveState(state, path = statePath()) {
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
