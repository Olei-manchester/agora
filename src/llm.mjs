import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT = 120000;

export function codexBin() {
  return process.env.CODEX_CLI_PATH || process.env.CODEX_CLI || 'codex';
}

export async function codexReply(prompt, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const dir = await mkdtemp(join(tmpdir(), 'city-llm-'));
  const out = join(dir, 'out.txt');
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '-s',
    'read-only',
    '--color',
    'never',
    '-o',
    out,
  ];
  if (cwd) args.push('-C', cwd);
  if (opts.model) args.push('-m', opts.model);
  args.push(prompt);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(codexBin(), args, {
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      });
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { child.kill(); } catch {}
        reject(new Error('codex exec timed out after ' + timeoutMs + 'ms'));
      }, timeoutMs);
      child.on('error', (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error('codex exec exited ' + code));
      });
    });
    return (await readFile(out, 'utf8')).trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
