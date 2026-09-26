import type { Metadata } from 'next';
import BountyApp from '../../../../bounty-app';
export const metadata: Metadata = { title: '任务详情｜ProofPay' };
export default async function ChineseTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BountyApp locale="zh" view="detail" taskId={id} />;
}
