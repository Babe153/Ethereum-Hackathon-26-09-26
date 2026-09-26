"use client";
import { useEffect, useState } from "react";
type Status = 'online' | 'offline' | 'degraded' | 'unknown';
type Service = { status: Status; lastSeen?: number | null };
const roles = ['api', 'agent', 'verifier'] as const;
type Health = Record<typeof roles[number], Service>;
const unknown: Health = { api: { status: 'unknown' }, agent: { status: 'unknown' }, verifier: { status: 'unknown' } };
export default function ServiceHealth({ url }: { url: string }) {
  const [health, setHealth] = useState<Health>(unknown);
  const [checked, setChecked] = useState<number | null>(null);
  useEffect(() => {
    let active = true, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`${url}/health`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw Error('API unavailable');
        const data = await response.json();
        if (data.ok !== true) throw Error('Invalid health response');
        const next: Health = { ...unknown, api: { status: 'online' } };
        for (const role of ['agent', 'verifier'] as const) {
          const service = data.services?.[role];
          if (service && ['online','offline','degraded','unknown'].includes(service.status)) next[role] = service;
        }
        if (active) setHealth(next);
      } catch {
        if (active) setHealth({ ...unknown, api: { status: 'offline' } });
      } finally {
        pending = false;
        if (active) setChecked(Date.now());
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 8000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  const messages: Record<Status, string> = { online: 'Online', offline: 'Offline / unreachable', degraded: 'Running · errors detected', unknown: 'Unknown' };
  return <section className="service-health" aria-label="Live service status">
    <div><strong>LIVE SERVICES</strong><small>{checked ? `Last checked ${new Date(checked).toLocaleTimeString()}` : 'Checking…'}</small></div>
    <div className="service-health-items">{roles.map(role => <div key={role} className={`service-indicator ${health[role].status}`}><b>{role === 'api' ? 'API' : role === 'agent' ? 'Agent' : 'Verifier'}</b><span>{messages[health[role].status]}</span>{health[role].lastSeen && <small>Heartbeat {new Date(health[role].lastSeen!).toLocaleTimeString()}</small>}</div>)}</div>
    <p>{health.api.status === 'offline' ? 'Live submissions are unavailable. Saved examples may still display; restore the API and tunnel before a live demo.' : health.agent.status !== 'online' || health.verifier.status !== 'online' ? 'Automatic delivery or verification may be delayed. Check the worker processes; API availability alone does not mean automation is ready.' : 'Processes are running. Model calls and transactions may still fail; follow each task’s on-chain status.'} Heartbeats older than 30 seconds are offline. Unknown means status could not be verified.</p>
  </section>;
}
