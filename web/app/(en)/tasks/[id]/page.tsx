import type { Metadata } from 'next';
import BountyApp from '../../../bounty-app';
export const metadata: Metadata = { title: 'Task details | ProofPay' };
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BountyApp locale="en" view="detail" taskId={id} />;
}
