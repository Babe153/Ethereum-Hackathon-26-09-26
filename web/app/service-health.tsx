"use client";
import { useEffect, useState } from "react";
type Status = 'online' | 'offline' | 'degraded' | 'unknown';
type Service = { status: Status; lastSeen?: number | null };
const roles = ['api', 'agent', 'verifier'] as const;
type Health = Record<typeof roles[number], Service>;
const unknown: Health = { api: { status: 'unknown' }, agent: { status: 'unknown' }, verifier: { status: 'unknown' } };
export default function ServiceHealth({ url, locale = 'en' }: { url: string; locale?: 'en' | 'zh' }) {
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
  const zh = locale === 'zh';
  const messages: Record<Status, string> = zh ? { online: '在线', offline: '离线或无法访问', degraded: '运行中 · 检测到错误', unknown: '状态未知' } : { online: 'Online', offline: 'Unreachable', degraded: 'Errors detected', unknown: 'Unknown' };
  return <section className="service-health" aria-label="Live service status">
    <div><strong>{zh ? '运行状态' : 'SYSTEM STATUS'}</strong><small>{checked ? (zh ? '最近检查 ' : 'Last checked ') + new Date(checked).toLocaleTimeString() : zh ? '检查中…' : 'Checking…'}</small></div>
    <div className="service-health-items">{roles.map(role => <div key={role} className={`service-indicator ${health[role].status}`}><b>{role === 'api' ? (zh ? '提交服务' : 'Submission API') : role === 'agent' ? (zh ? 'AI 接单者' : 'AI Worker') : (zh ? 'AI 验收者' : 'AI Verifier')}</b><span>{messages[health[role].status]}</span>{health[role].lastSeen && <small>{zh ? '最近心跳 ' : 'Heartbeat '}{new Date(health[role].lastSeen!).toLocaleTimeString()}</small>}</div>)}</div>
    <p>{health.api.status === 'offline' ? (zh ? '实时提交暂不可用。历史任务仍可能显示，请恢复 API 和隧道后再演示新任务。' : 'Live submissions are unavailable. Historical examples may still display; restore the API and tunnel before a live demo.') : health.agent.status !== 'online' || health.verifier.status !== 'online' ? (zh ? '自动交付或验收可能延迟。请检查后台进程，API 可访问不代表自动化已就绪。' : 'Delivery or verification may be delayed. Check worker processes before starting a live task.') : (zh ? '后台进程正在运行。模型调用和交易仍可能失败，请以任务链上状态为准。' : 'Processes are running. Follow each task’s on-chain status for delivery and settlement.')}</p>
    <details><summary>{zh ? '状态说明' : 'About these indicators'}</summary><p>{zh ? '每 8 秒检查一次；心跳超过 30 秒未更新显示离线。未知表示无法确认。在线仅说明进程存活，不保证每次 AI 调用或交易成功。' : 'Checked every 8 seconds. Heartbeats older than 30 seconds are offline. Unknown means unverified. Online indicates process liveness, not guaranteed execution.'}</p></details>
  </section>;
}
