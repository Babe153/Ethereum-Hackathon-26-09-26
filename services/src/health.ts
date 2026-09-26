import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const STALE_MS = 30_000;
type Role = 'agent' | 'verifier';
type Beat = { at: number; state: 'online' | 'degraded'; chainId: string; escrow: string };
export function classify(beat: Beat | null, now = Date.now()) {
  if (!beat || !Number.isFinite(beat.at) || now - beat.at > STALE_MS || beat.at > now + 5000)
    return { status: 'offline', lastSeen: beat?.at ?? null };
  if (beat.chainId !== (process.env.CHAIN_ID || '133') || beat.escrow !== (process.env.ESCROW_ADDRESS || '').toLowerCase())
    return { status: 'unknown', lastSeen: beat.at };
  return { status: beat.state === 'online' ? 'online' : 'degraded', lastSeen: beat.at };
}
function directory() { return resolve(process.cwd(), 'data', 'health'); }
export async function readHealth(role: Role) {
  try { return classify(JSON.parse(await readFile(resolve(directory(), `${role}.json`), 'utf8'))); }
  catch { return classify(null); }
}
// Files are written only by local processes; no public heartbeat endpoint to spoof.
export function startHeartbeat(role: Role) {
  let state: Beat['state'] = 'online';
  let writing = false;
  async function write() {
    if (writing) return;
    writing = true;
    try {
      await mkdir(directory(), { recursive: true });
      const file = resolve(directory(), `${role}.json`);
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ at: Date.now(), state, chainId: process.env.CHAIN_ID || '133', escrow: (process.env.ESCROW_ADDRESS || '').toLowerCase() }));
      await rename(temp, file);
    } catch { console.error(`${role} heartbeat write failed`); }
    finally { writing = false; }
  }
  void write();
  const timer = setInterval(() => void write(), 5000);
  timer.unref();
  return { healthy: () => { state = 'online'; }, failed: () => { state = 'degraded'; } };
}
