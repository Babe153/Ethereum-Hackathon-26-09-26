import type { Metadata } from 'next';
import BountyApp from '../../../bounty-app';
export const metadata: Metadata = { title: '发布任务｜ProofPay' };
export default function ChinesePostPage() { return <BountyApp locale="zh" view="post" />; }
